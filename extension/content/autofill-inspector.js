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

class AutofillInspector {
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
        this.updateFieldsInfo(request.data);
        break;
      }
      case 'show': {
        document.querySelectorAll("tr.selected").forEach(row =>
          this.addHighlightOverlay("select", this.#rowToFieldDetail.get(row))
        );
      }
    }
  }

  onInspect() {
    this.#inspectedFieldDetails = null;
    this.sendMessage("inspect");
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

  onScreenshot() {
    this.sendMessage("screenshot")
  }

  onDownloadPage() {
    this.sendMessage("freeze");
  }

  async onGenerateTest() {
    if (!this.#inspectedFieldDetails) {
      // TODO: Show warning dialog
      return;
    }
    const inspectResult = this.fieldDetailsToTestExpectedResult(this.#inspectedFieldDetails);

    this.sendMessage("generate-testcase", { inspectResult });
  }

  async onReportIssue() {
    if (!this.#inspectedFieldDetails) {
      // TODO: Show warning dialog
      return;
    }
    const inspectResult = this.fieldDetailsToTestExpectedResult(this.#inspectedFieldDetails);

    this.sendMessage("report", { inspectResult });
  }

  onEditFields(event) {
    let hasChanged = false;
    const isEditing = event.target.classList.contains("editing");
    document.querySelectorAll("td#col-fieldName").forEach(cell => {
      if (isEditing) {
        const select = cell.querySelector("select");
        if (select.classList.contains("changed")) {
          hasChanged = true;
          const tr = select.closest("tr");
          const fieldDetail = this.#rowToFieldDetail.get(tr);
          // TODO: We should not change the underlying element.
          // It will cause testcase not matches...
          this.sendMessage(
            "change-field-attribute",
            {
              frameId: fieldDetail.frameId,
              inspectId: fieldDetail.inspectId,
              attribute: "autocomplete",
              value: select.value,
            }
          );
        }
        cell.textContent = select.value;
        select.remove();
      } else {
        const select = document.createElement("select");

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
          } else {
            select.classList.remove("changed");
          }
        });

        cell.innerHTML = "";
        cell.appendChild(select);
      }
    });
    if (hasChanged) {
      this.onInspect();
    }
    event.target.classList.toggle("editing");
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

  // TODO: Maybe we should just export the HTML?
  async onExportInspectResult() {
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

    const filename = "screenshot.png";
    const dataUrl = canvas.toDataURL("image/png");
    this.sendMessage("download", { filename, dataUrl });
  }

  // TODO: Add data-moz-autofill-field-type=xxx
  //       for machine learning purpose
  //       All visible fields, add "unknown"
  #buttonClickHandlers = [
    ["autofill-inspect-start-button", () => this.onInspect()],
    ["autofill-inspect-element-button", () => this.onInspectElement()],
    ["autofill-screenshot-button", () => this.onScreenshot()],
    ["autofill-download-button", () => this.onDownloadPage()],
    ["autofill-report-button", () => this.onReportIssue()],
    ["autofill-edit-field-button", (event) => this.onEditFields(event)],
    ["autofill-generate-test-button", () => this.onGenerateTest()],
    ["autofill-export-button", () => this.onExportInspectResult()],
  ]

  #checkboxChangeHandlers = [
    ["autofill-add-address-button", () => this.onAddOrRemoveTestRecord()],
    ["autofill-add-credit-card-button", () => this.onAddOrRemoveTestRecord()],
  ]

  init() {
    // TODO: remove this???
    this.sendMessage("init");

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
      {id: "col-identifier", text: "Id/Name"},
      {id: "col-fieldName", text: "FieldName"},
      {id: "col-reason", text: "Reason"},
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

  addHighlightOverlay(type, fieldDetail) {
    this.sendMessage(
      "highlight",
      {
        type,
        inspectId: fieldDetail.inspectId,
        frameId: fieldDetail.frameId,
      }
    );
  }

  // Type should be either `select` or `hover`
  removeHighlightOverlay(type, fieldDetail) {
    this.sendMessage(
      "highlight-remove",
      {
        type,
        inspectId: fieldDetail.inspectId,
        frameId: fieldDetail.frameId,
      }
    );
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
      if (event.target.hasAttribute("rowspan")) {
        tr.classList.add('className', 'autofill-hide-highlight');
        return;
      }

      this.addHighlightOverlay("hover", fieldDetail);
      this.scrollIntoView(fieldDetail);
    });

    tr.addEventListener("mouseout", (event) => {
      event.preventDefault();
      if (event.target.hasAttribute("rowspan")) {
        tr.classList.remove('className', 'autofill-hide-highlight');
        return;
      }

      this.removeHighlightOverlay("hover", fieldDetail);
    });
  }

  updateFieldsInfo(fieldDetails) {
    // Clone the field detail array
    this.#inspectedFieldDetails = Array.from(fieldDetails, item => ({ ...item }));

    const tbody = document.getElementById("form-analysis-table-body");
    while (tbody.firstChild) {
      tbody.firstChild.remove();
    }

    const cols = document.getElementById("form-analysis-head-row").childNodes;
    let nthSection = -1;

    let formNextIndex;
    let sectionNextIndex;
    let frameNextIndex;

    for (let index = 0; index < this.#inspectedFieldDetails?.length; index++) {
      const fieldDetail = fieldDetails[index];

      const tr = document.createElement("tr");
      tr.classList.add("field-list-item");

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
        //if (["col-root", "col-section", "col-frame"].includes(event.target.id)) {
        let rows;
        if (event.target.hasAttribute("rowspan")) {
          rows = this.getSpannedRows(event.target);
        } else {
          rows = [tr];
        }

        for (const row of rows) {
          if (row.classList.contains("selected")) {
            this.removeHighlightOverlay("select", this.#rowToFieldDetail.get(row));
          } else {
            this.addHighlightOverlay("select", this.#rowToFieldDetail.get(row))
          }
          row.classList.toggle("selected");
        }
      });
    });
  }

  fieldDetailsToTestExpectedResult(fieldDetails) {
    let expectedSection;
    const sections = [];
    let formIndex;
    let sectionIndex;
    for (const fieldDetail of fieldDetails) {
      if (fieldDetail.formIndex != formIndex ||
          fieldDetail.sectionIndex != sectionIndex) {
        formIndex = fieldDetail.formIndex;
        sectionIndex = fieldDetail.sectionIndex;

        expectedSection = {
          fields: [],
        };
        sections.push(expectedSection);
      }
      let expectedField = {
        fieldName: fieldDetail.fieldName,
        reason: fieldDetail.reason,
      };
      if (fieldDetail.part) {
        expectedField.part = fieldDetail.part;
      }
      expectedSection.fields.push(expectedField);
    }
    return sections;
  }
}

let inspector = new AutofillInspector();
