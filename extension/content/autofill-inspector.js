/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
//import freezeDry from './libs/freeze-dry.es.js'

const CREDIT_CARD_TYPES = [
  "cc-name",
  "cc-given-name",
  "cc-additional-name",
  "cc-family-name",
  "cc-number",
  "cc-exp-month",
  "cc-exp-year",
  "cc-exp",
  "cc-type",
  "cc-csc",
];

const ADDRESS_TYPES = [
  "name",
  "given-name",
  "additional-name",
  "family-name",
  "organization",
  "email",
  "street-address",
  "address-line1",
  "address-line2",
  "address-line3",
  "address-level1",
  "address-level2",
  "address-streetname",
  "address-housenumber",
  "postal-code",
  "country",
  "country-name",
  "tel",
  "tel-country-code",
  "tel-national",
  "tel-area-code",
  "tel-local",
  "tel-local-prefix",
  "tel-local-suffix",
  "tel-extension",
];

// Utils
function findNextIndex(array, currentIndex, condition) {
  for (let i = currentIndex + 1; i < array.length; i++) {
    if (condition(array[i])) {
        return i;
    }
  }
  return array.length;
}

function findTdInSameRowById(targetTd, id) {
  const parentRow = targetTd.closest('tr');
  if (!parentRow) {
    return null;
  }

  const targetTdById = parentRow.querySelector(`td#${id}`);
  return targetTdById;
}

class AutofillInspector {
  #changes = new Map();

  #inspectedFieldDetails = null;

  #rowToFieldDetail = new Map();

  constructor() {
    document.addEventListener("DOMContentLoaded", () => this.init(), { once: true });
    // Handle requests from background script.
    browser.runtime.onMessage.addListener(request => this.onMessage(request));
  }

  sendMessage(msg, request) {
    browser.runtime.sendMessage({
      msg,
      tabId: browser.devtools.inspectedWindow.tabId,
      ...request,
    });
  }

  onMessage(request) {
    if (request.tabId != browser.devtools.inspectedWindow.tabId) {
      return;
    }

    switch (request.msg) {
      case 'inspect-complete': {
        // Clone the field detail array
        this.#inspectedFieldDetails = Array.from(request.data, item => ({ ...item }));
        this.updateFieldsInfo(this.#inspectedFieldDetails);

        // Unblock those waiting for inspect results
        this.onInspectCompleteResolver?.();
        this.onInspectCompleteResolver = null;
        break;
      }
      case 'show': {
        document.querySelectorAll("tr.selected").forEach(row =>
          this.addHighlightOverlay("select", this.#rowToFieldDetail.get(row))
        );
        break;
      }
      case 'notify-progress': {
        this.onUpdateProgressStatus(request.progress);
        break;
      }
    }
  }

  onClickInspect() {
    this.#changes.clear();
    this.inspect();
  }

  inspect() {
    this.#inspectedFieldDetails = null;
    this.sendMessage("inspect", { changes: Array.from(this.#changes.values()) });
  }

  onInspectElement() {
    const row = document.querySelector("tr.selected");
    const fieldDetail = this.#rowToFieldDetail.get(row);
    const js = `
      (function() {
        const selector = '[data-moz-autofill-inspect-id="${fieldDetail.inspectId}"]'
        inspect(document.querySelector(selector));
      })();
    `;
    browser.devtools.inspectedWindow.eval(js).catch((e) => console.error(e));
  }

  async waitForInspect() {
    if (!this.#inspectedFieldDetails) {
      const waitForInspect = new Promise(resolve => this.onInspectCompleteResolver = resolve);
      this.inspect();
      await waitForInspect;
    }
  }

  async captureInspectorPanel() {
    // TODO: Can this move to the background script?
    // Use html2Canvas to screenshot
    const element = document.querySelector(".autofill-panel");
    const width = element.scrollWidth;
    const height =
      document.querySelector(".devtools-toolbar").scrollHeight +
      document.querySelector(".field-list-scroll").scrollHeight

    const canvas = await html2canvas(element, {
      allowTaint: true,
      useCORS: true,
      x: 0,
      y: 0,
      width,
      height: height,
      windowHeight: height,
    });

    return canvas.toDataURL("image/png");
  }

  async onScreenshot() {
    this.onUpdateProgressStatus("exporting inspect result");
    await this.waitForInspect();

    const panelDataUrl = await this.captureInspectorPanel();
    this.sendMessage("export-inspect", { panelDataUrl, saveAs: false });
  }

  async onDownloadPage() {
    this.onUpdateProgressStatus("downloading page");
    await this.waitForInspect();

    this.sendMessage("freeze", { fieldDetails: this.#inspectedFieldDetails });
  }

  async onGenerateReport() {
    this.onUpdateProgressStatus("generating report");
    await this.waitForInspect();

    const panelDataUrl = await this.captureInspectorPanel();
    this.sendMessage("generate-report", { panelDataUrl, fieldDetails: this.#inspectedFieldDetails });
  }

  async onReportIssue() {
    this.onUpdateProgressStatus("reporting issue");
    await this.waitForInspect();

    const panelDataUrl = await this.captureInspectorPanel();
    this.sendMessage("report-issue",
      {
        panelDataUrl,
        fieldDetails: this.#inspectedFieldDetails,
        changes: Array.from(this.#changes.values())
      }
    );
  }

  // TODO:
  // - Fix the coding...
  // = Need to know the original value
  // - Different button icon so we know we need to apply
  // - Show different color or add icon to modified field
  // - DO not change FieldName size in edit mode
  async onEditFields(event) {
    await this.waitForInspect();

    let hasChanged = false;
    const isEditing = event.target.classList.contains("editing");
    document.querySelectorAll("td#col-fieldName").forEach(cell => {
      const tr = cell.closest("tr");
      const fieldDetail = this.#rowToFieldDetail.get(tr);

      if (isEditing) {
        // Done editing, let's update the value
        const select = cell.querySelector("select");
        if (select.classList.contains("changed")) {
          hasChanged = true;
          const change = { inspectId: fieldDetail.inspectId }
          const tdReason = findTdInSameRowById(cell, `col-reason`);
          const reasonSelect = tdReason.querySelector("select");
          if (reasonSelect) {
            tdReason.textContent = reasonSelect.value;
            change["reason"] = reasonSelect.value;
          }
          reasonSelect?.remove();
          change["fieldName"] = select.value;
          this.#changes.set(fieldDetail.inspectId, change);
        } else {
          this.#changes.delete(fieldDetail.inspectId);
        }
        cell.textContent = select.value;
        select.remove();

      } else {
        // Clear when editing
        cell.classList.remove("changed");

        const select = document.createElement("select");
        if (this.#changes.has(fieldDetail.inspectId)) {
          select.classList.add("changed");
        }

        [...ADDRESS_TYPES, ...CREDIT_CARD_TYPES].forEach(fieldName => {
          const option = document.createElement("option");
          option.value = fieldName;
          option.textContent = fieldName;
          if (fieldName === cell.textContent) {
            // Move the matched <select> to the first one
            select.insertBefore(option, select.firstChild);
            option.selected = true;
          } else {
            select.appendChild(option);
          }
        });

        // Avoid triggering click for the row
        select.addEventListener("click", (event) => event.stopPropagation());
        select.addEventListener("change", () => {
          if (select.selectedIndex !== 0) {
            select.classList.add("changed");
            // TODO: Also Make Reason Field Changeable
            const tdReason = findTdInSameRowById(cell, `col-reason`);
            if (!tdReason.querySelector("select")) {
              const reasonSelect = document.createElement("select");
              ["autocomplete", "update-heuristic", "regex-heuristic", "fathom"].forEach(reason => {
                const option = document.createElement("option");
                option.value = reason;
                option.textContent = reason;
                if (reason === cell.textContent) {
                  // Move the matched <select> to the first one
                  reasonSelect.insertBefore(option, reasonSelect.firstChild);
                  option.reasonSelected = true;
                } else {
                  reasonSelect.appendChild(option);
                }
              });
              reasonSelect.addEventListener("change", () => {
                if (reasonSelect.reasonSelectedIndex !== 0) {
                  reasonSelect.classList.add("changed");
                } else {
                  reasonSelect.classList.remove("changed");
                }
              });
              tdReason.innerHTML = "";
              tdReason.appendChild(reasonSelect);
            }
          } else {
            select.classList.remove("changed");
          }
        });

        cell.innerHTML = "";
        cell.appendChild(select);
      }
    });
    if (hasChanged) {
      this.inspect();
    }
    event.target.classList.toggle("editing");
  }

  onFilterFields() {
    this.updateFieldsInfo(this.#inspectedFieldDetails);
  }

  async onAddOrRemoveTestRecord() {
    this.sendMessage(
      "set-test-records",
      {
        address: document.getElementById("autofill-add-address-button").checked,
        creditcard: document.getElementById("autofill-add-credit-card-button").checked,
      }
    );
  }

  onUpdateProgressStatus(progressText) {
    const element = document.querySelector(".autofill-progress-status");
    element.textContent = progressText;

  }
  #buttonClickHandlers = [
    ["autofill-inspect-start-button", () => this.onClickInspect()],
    ["autofill-inspect-element-button", () => this.onInspectElement()],
    ["autofill-screenshot-button", () => this.onScreenshot()],
    ["autofill-download-button", () => this.onDownloadPage()],
    ["autofill-report-button", () => this.onReportIssue()],
    ["autofill-edit-field-button", (event) => this.onEditFields(event)],
    ["autofill-generate-test-button", () => this.onGenerateReport()],
  ]

  #checkboxChangeHandlers = [
    ["autofill-show-invisible-button", () => this.onFilterFields()],
    ["autofill-show-unknown-button", () => this.onFilterFields()],
    ["autofill-add-address-button", () => this.onAddOrRemoveTestRecord()],
    ["autofill-add-credit-card-button", () => this.onAddOrRemoveTestRecord()],
  ]

  init() {
    for (const [id, handler] of this.#buttonClickHandlers) {
      const button = document.getElementById(id);
      button.addEventListener("click", handler);
    }

    for (const [id, handler] of this.#checkboxChangeHandlers) {
      const checkbox = document.getElementById(id);
      checkbox.addEventListener("change", event => handler(event));
    }

    const headers = [
      {id: "col-root", text: "Root"},
      {id: "col-section", text: "Section"},
      {id: "col-frame", text: "Frame"},
      {id: "col-fieldName", text: "FieldName"},
      {id: "col-reason", text: "Reason"},
      {id: "col-identifier", text: "Id/Name"},
      {id: "col-isVisible", text: "Visible"},
      {id: "col-part", text: "Part"},
      {id: "col-confidence", text: "Confidence"},
    ];

    const head_tr = document.getElementById("form-analysis-head-row");
    headers.forEach(header => {
      const th = document.createElement("th");
      th.setAttribute("id", header.id);
      th.setAttribute("class", "field-list-column");
      const div = document.createElement("div");
      div.innerHTML = header.text;
      th.appendChild(div);
      head_tr.appendChild(th);
    });
  }

  fieldDetailToColumnValue(columnId, fieldDetail) {
    const regex = /^col-(.*)$/;
    const fieldName = columnId.match(regex)[1];
    return fieldDetail[fieldName];
  }

  scrollIntoView(fieldDetail) {
    this.sendMessage(
      "scroll", {
        inspectId: fieldDetail.inspectId,
        frameId: fieldDetail.frameId,
      }
    );
  }

  addHighlightOverlay(type, fieldDetails) {
    this.sendMessage("highlight", { type, fieldDetails });
  }

  // Type should be either `select` or `hover`
  removeHighlightOverlay(type, fieldDetails) {
    this.sendMessage("highlight-remove", { type, fieldDetails });
  }

  getSpannedRows(td) {
    const rowSpan = td.rowSpan;
    const currentRow = td.parentElement;
    const table = currentRow.parentElement;

    const rowIndex = Array.from(table.children).indexOf(currentRow);

    const spannedRows = [];
    for (let i = 0; i < rowSpan; i++) {
      const nextRow = table.children[rowIndex + i];
      if (nextRow) {
          spannedRows.push(nextRow);
      }
    }
    return spannedRows;
  }

  setupRowMouseOver(tr, fieldDetail) {
    tr.addEventListener("mouseover", (event) => {
      event.preventDefault();
      let rows;
      if (event.target.hasAttribute("rowspan")) {
        tr.classList.add('className', 'autofill-hide-highlight');
        rows = this.getSpannedRows(event.target);
      } else {
        rows = [tr];
      }

      this.scrollIntoView(fieldDetail);
      this.addHighlightOverlay("hover", rows.map(r => this.#rowToFieldDetail.get(r)));
    });

    tr.addEventListener("mouseout", (event) => {
      event.preventDefault();
      let rows;
      if (event.target.hasAttribute("rowspan")) {
        tr.classList.remove('className', 'autofill-hide-highlight');
        rows = this.getSpannedRows(event.target);
      } else {
        rows = [tr];
      }

      this.removeHighlightOverlay("hover", rows.map(r => this.#rowToFieldDetail.get(r)));
    });
  }

  updateFieldsInfo(fieldDetails) {
    this.#rowToFieldDetail.clear();
    const showInvisible = document.getElementById("autofill-show-invisible-button").checked;
    const showUnknown = document.getElementById("autofill-show-unknown-button").checked;
    fieldDetails = fieldDetails.filter(fieldDetail => {
      if (!fieldDetail.isVisible && !showInvisible) {
        return false;
      }
      if (!fieldDetail.fieldName && !showUnknown) {
        return false;
      }
      return true;
    });

    const tbody = document.getElementById("form-analysis-table-body");
    while (tbody.firstChild) {
      tbody.firstChild.remove();
    }

    const cols = document.getElementById("form-analysis-head-row").childNodes;
    let nthSection = -1;

    let formNextIndex;
    let sectionNextIndex;
    let frameNextIndex;

    for (let index = 0; index < fieldDetails?.length; index++) {
      const fieldDetail = fieldDetails[index];

      const tr = document.createElement("tr");
      tr.classList.add("field-list-item");
      if (!fieldDetail.isVisible) {
        tr.classList.add("invisible");
      }
      if (!fieldDetail.fieldName) {
        tr.classList.add("unknown");
      }

      // Setup the mouse over handler for this row
      this.#rowToFieldDetail.set(tr, fieldDetail);
      this.setupRowMouseOver(tr, fieldDetail);

      for (const column of cols) {
        if (!column.id) {
          continue;
        }
        const td = document.createElement("td");
        td.setAttribute("class", "field-list-column")
        td.id = column.id;

        switch (column.id) {
          case "col-root": {
            if (formNextIndex && index < formNextIndex) {
              continue;
            }
            formNextIndex = findNextIndex(fieldDetails, index, (compare) =>
              fieldDetail.formIndex != compare.formIndex
            );
            td.setAttribute("rowspan", formNextIndex - index);

            td.classList.add("field-icon");
            td.classList.add("field-form-icon");
            break;
          }
          case "col-section": {
            if (sectionNextIndex && index < sectionNextIndex) {
              continue;
            }
            sectionNextIndex = findNextIndex(fieldDetails, index, (compare) =>
              fieldDetail.sectionIndex != compare.sectionIndex
            );
            if (sectionNextIndex > formNextIndex) {
              sectionNextIndex = formNextIndex;
            }
            td.setAttribute("rowspan", sectionNextIndex - index);

            nthSection++;
            td.classList.add("field-icon");
            if (fieldDetail.fieldName.startsWith("cc-")) {
              td.classList.add("field-credit-card-icon");
            } else {
              td.classList.add("field-address-icon");
            }
            break;
          }
          case "col-frame": {
            if (frameNextIndex && index < frameNextIndex) {
              continue;
            }
            frameNextIndex = findNextIndex(fieldDetails, index, (compare) =>
              fieldDetail.browsingContextId != compare.browsingContextId
            );
            if (frameNextIndex > sectionNextIndex) {
              frameNextIndex = sectionNextIndex;
            }
            td.setAttribute("rowspan", frameNextIndex - index);

            td.appendChild(document.createTextNode(fieldDetail.frame));
            break;
          }
          default: {
            if (!fieldDetail.isVisible) {
              td.classList.add("autofill-invisible-field");
            }

            if (column.id == "col-fieldName") {
              if (this.#changes.has(fieldDetail.inspectId)) {
                td.classList.add("changed");
              }
            }

            const text = this.fieldDetailToColumnValue(column.id, fieldDetail);
            td.appendChild(document.createTextNode(text));
            break;
          }
        }
        tr.appendChild(td);
      }

      if (nthSection % 2) {
        tr.classList.add("autofill-section-even");
      }
      tbody.appendChild(tr);
    }

    document.querySelectorAll(".field-list-item").forEach(tr => {
      tr.addEventListener("click", () => {
        const rows = event.target.hasAttribute("rowspan") ?
          this.getSpannedRows(event.target) : [tr];

        let remove = [];
        let add = [];
        for (const row of rows) {
          if (row.classList.contains("selected")) {
            remove.push(this.#rowToFieldDetail.get(row));
          } else {
            add.push(this.#rowToFieldDetail.get(row));
          }
          row.classList.toggle("selected");
        }
        this.removeHighlightOverlay("select", remove);
        this.addHighlightOverlay("select", add);
      });
    });
  }

}

let inspector = new AutofillInspector();
