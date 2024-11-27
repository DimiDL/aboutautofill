/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

/* global browser html2canvas */

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

// Utility Functions
/**
 * Finds the next index in an array that satisfies a given condition.
 *
 * @param {Array} array
 *        The array to search through.
 * @param {Integer} currentIndex
 *        The current index to start searching from.
 * @param {Function} condition
 *        A callback function to find the element.
 * @returns {Integer}
 *        The index of the next element that satisfies the condition, or the array length if none is found.
 */
function findNextIndex(array, currentIndex, condition) {
  for (let i = currentIndex + 1; i < array.length; i++) {
    if (condition(array[i])) {
        return i;
    }
  }
  return array.length;
}

/**
 * Finds a `td` element in the same row as a given `td`, identified by its ID.
 *
 * @param {HTMLTableCellElement} td
 *        The reference table cell element.
 * @param {string} id
 *        The ID of the target `td` element to find.
 * @returns {HTMLTableCellElement|null}
 *       The found `td` element, or `null` if not found.
 */
function findTdInSameRowById(td, id) {
  return td.closest('tr')?.querySelector(`td#${id}`);
}

/**
 * Retrieves all rows spanned by a given `td` element, based on its `rowSpan` attribute.
 *
 * @param {HTMLTableCellElement} td
 *        The reference table cell element.
 * @returns {HTMLTableRowElement[]}
 *        An array of rows spanned by the `td` element.
 */
function getSpannedRows(td) {
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

/**
 * Sends a message to the background script, including the current inspected tab's ID.
 *
 * @param {string} msg 
 *        The message type or identifier.
 * @param {Object} request
 *        Additional data to send along with the message.
 */
function sendMessage(msg, request) {
  browser.runtime.sendMessage({
    msg,
    tabId: browser.devtools.inspectedWindow.tabId,
    ...request,
  });
}

class AutofillInspector {
  /**
   * Map that stores field names manually updated by their inspection IDs.
   * Key: inspection ID (string)
   * Value: updated field name (string)
   */
  #updateFieldNameByInspectId = new Map();

  /**
   * Array contains the list of all inspected elements. This value
   * is set after calling `inspect` experiment API.
   */
  #inspectedFieldDetails = null;

  /**
   * Map that maintains a mapping between table row (`<tr>`) elements
   * and their corresponding field details.
   */
  #rowToFieldDetail = new Map();

  #buttonClickHandlers = [
    ["autofill-inspect-start-button", () => this.onInspect()],
    ["autofill-inspect-element-button", () => this.onInspectElement()],
    ["autofill-screenshot-button", () => this.onScreenshot()],
    ["autofill-download-button", () => this.onDownloadPage()],
    ["autofill-report-button", () => this.onReportIssue()],
    ["autofill-edit-field-button", () => this.onEditFields()],
    ["autofill-generate-test-button", () => this.onGenerateReport()],
  ]

  #checkboxChangeHandlers = [
    ["autofill-show-invisible-button", () => this.onFilterFields()],
    ["autofill-show-unknown-button", () => this.onFilterFields()],
    ["autofill-add-address-button", () => this.onAddOrRemoveTestRecord()],
    ["autofill-add-credit-card-button", () => this.onAddOrRemoveTestRecord()],
  ]

  /**
   * Array of <th> configuration of the header of inspect result table.
   */
  #tableHeaders = [
    {id: "col-form", text: "Form"},
    {id: "col-section", text: "Section"},
    {id: "col-frame", text: "Frame"},
    {id: "col-fieldName", text: "FieldName"},
    {id: "col-reason", text: "Reason"},
    {id: "col-identifier", text: "Id/Name"},
    {id: "col-isVisible", text: "Visible"},
    {id: "col-part", text: "Part"},
    {id: "col-confidence", text: "Confidence"},
  ];

  constructor() {
    document.addEventListener("DOMContentLoaded", () => this.init(), { once: true });
    // Handle requests from background script.
    browser.runtime.onMessage.addListener(request => this.onMessage(request));
  }

  init() {
    // Helper to attach event listeners
    const addEventListeners = (handlers, eventType) => {
      for (const [id, handler] of handlers) {
        const element = document.getElementById(id);
        element.addEventListener(eventType, event => handler(event));
      }
    };

    // Setup toolbar button and checkbox change handlers
    addEventListeners(this.#buttonClickHandlers, "click");
    addEventListeners(this.#checkboxChangeHandlers, "change");

    // Setup inspect result table
    const headerRow = document.getElementById("form-analysis-head-row");
    headerRow.append(
      ...this.#tableHeaders.map(header => {
        const th = document.createElement("th");
        th.id = header.id;
        th.className = "field-list-column";
        th.innerHTML = `<div>${header.text}</div>`;
        return th;
      })
    );
  }

  /**
   * Process message from the background script
   */
  onMessage(request) {
    if (request.tabId != browser.devtools.inspectedWindow.tabId) {
      return;
    }

    switch (request.msg) {
      case 'inspect-complete': {
        // Clone the field detail array
        this.#inspectedFieldDetails = Array.from(request.data, item => ({ ...item }));
        this.#updateFieldsInfo(this.#inspectedFieldDetails);

        // Unblock those waiting for inspect results
        this.onInspectCompleteResolver?.();
        this.onInspectCompleteResolver = null;
        break;
      }
      case 'show': {
        document.querySelectorAll("tr.selected").forEach(row =>
          this.#addHighlightOverlay("select", this.#rowToFieldDetail.get(row))
        );
        break;
      }
      case 'notify-progress': {
        this.#updateProgress(request.progress);
        break;
      }
    }
  }

  inspect() {
    this.#inspectedFieldDetails = null;
    sendMessage("inspect", { changes: Array.from(this.#updateFieldNameByInspectId.values()) });
  }

  /**
   * Inspect the autofill fields information for the whole page.
   */
  onInspect() {
    this.#updateFieldNameByInspectId.clear();
    this.inspect();
  }

  /**
   * Call devtools inspector API to inspect the selected element
   */
  onInspectElement() {
    // There might be multiple selected elements, we always inspect the first one.
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

  async onScreenshot() {
    this.#updateProgress("exporting inspect result");
    await this.waitForInspect();

    const panelDataUrl = await this.#captureInspectorPanel();
    sendMessage("export-inspect", { panelDataUrl, saveAs: false });
  }

  async onDownloadPage() {
    this.#updateProgress("downloading page");
    await this.waitForInspect();

    sendMessage("download-page", { fieldDetails: this.#inspectedFieldDetails });
  }

  async onGenerateReport() {
    this.#updateProgress("generating report");
    await this.waitForInspect();

    const panelDataUrl = await this.#captureInspectorPanel();
    sendMessage("generate-report", { panelDataUrl, fieldDetails: this.#inspectedFieldDetails });
  }

  async onReportIssue() {
    this.#updateProgress("reporting issue");
    await this.waitForInspect();

    const panelDataUrl = await this.#captureInspectorPanel();
    sendMessage("report-issue",
      {
        attachmentDataUrl: panelDataUrl,
        fieldDetails: this.#inspectedFieldDetails,
        changes: Array.from(this.#updateFieldNameByInspectId.values())
      }
    );
  }

  // TODO:
  // - Fix the coding...
  // = Need to know the original value
  // - Different button icon so we know we need to apply
  // - Show different color or add icon to modified field
  // - DO not change FieldName size in edit mode
  async onEditFields() {
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
          this.#updateFieldNameByInspectId.set(fieldDetail.inspectId, change);
        } else {
          this.#updateFieldNameByInspectId.delete(fieldDetail.inspectId);
        }
        cell.textContent = select.value;
        select.remove();

      } else {
        // Clear when editing
        cell.classList.remove("changed");

        const select = document.createElement("select");
        if (this.#updateFieldNameByInspectId.has(fieldDetail.inspectId)) {
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
    this.#updateFieldsInfo(this.#inspectedFieldDetails);
  }

  onAddOrRemoveTestRecord() {
    sendMessage(
      "set-test-records",
      {
        address: document.getElementById("autofill-add-address-button").checked,
        creditcard: document.getElementById("autofill-add-credit-card-button").checked,
      }
    );
  }

  /**
   * Private Functions 
   */
  async #captureInspectorPanel() {
    // TODO: Can we move this to the background script?
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
      height,
      windowHeight: height,
    });

    return canvas.toDataURL("image/png");
  }

  #updateProgress(progressText) {
    const element = document.querySelector(".autofill-progress-status");
    element.textContent = progressText;
  }

  #fieldDetailToColumnValue(columnId, fieldDetail) {
    const regex = /^col-(.*)$/;
    const fieldName = columnId.match(regex)[1];
    return fieldDetail[fieldName];
  }

  #scrollIntoView(fieldDetail) {
    sendMessage("scroll", { fieldDetail });
  }

  #addHighlightOverlay(type, fieldDetails) {
    sendMessage("highlight", { type, fieldDetails });
  }

  // Type should be either `select` or `hover`
  #removeHighlightOverlay(type, fieldDetails) {
    sendMessage("highlight-remove", { type, fieldDetails });
  }

  #createRowFromFieldDetail(fieldDetail) {
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
    this.#setupRowMouseOver(tr, fieldDetail);
    return tr;
  }

  #setupRowMouseOver(tr, fieldDetail) {
    tr.addEventListener("mouseover", (event) => {
      event.preventDefault();
      let rows;
      if (event.target.hasAttribute("rowspan")) {
        tr.classList.add('className', 'autofill-hide-highlight');
        rows = getSpannedRows(event.target);
      } else {
        rows = [tr];
      }

      this.#scrollIntoView(fieldDetail);
      this.#addHighlightOverlay("hover", rows.map(r => this.#rowToFieldDetail.get(r)));
    });

    tr.addEventListener("mouseout", (event) => {
      event.preventDefault();
      let rows;
      if (event.target.hasAttribute("rowspan")) {
        tr.classList.remove('className', 'autofill-hide-highlight');
        rows = getSpannedRows(event.target);
      } else {
        rows = [tr];
      }

      this.#removeHighlightOverlay("hover", rows.map(r => this.#rowToFieldDetail.get(r)));
    });
  }

  /**
   * Update the inpsected result table
   *
   * @param <Array> fieldDetails
   *        The inspected result
   */
  #updateFieldsInfo(fieldDetails) {
    // Clear the previous result before updating.
    this.#rowToFieldDetail.clear();
    const tbody = document.getElementById("form-analysis-table-body");
    while (tbody.firstChild) {
      tbody.firstChild.remove();
    }

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

    const cols = document.getElementById("form-analysis-head-row").childNodes;
    let nthSection = -1;

    // Use row span for fields that belong to the same form, section, or frame
    // We need to calculate the span count for each case.
    let formSpanBoundary;
    let sectionSpanBoundary;
    let frameSpanBoundary;

    for (let index = 0; index < fieldDetails.length; index++) {
      const fieldDetail = fieldDetails[index];

      const tr = this.#createRowFromFieldDetail(fieldDetail);

      for (const column of cols) {
        if (!column.id) {
          continue;
        }
        const td = document.createElement("td");
        td.setAttribute("class", "field-list-column")
        td.id = column.id;

        switch (column.id) {
          case "col-form": {
            if (formSpanBoundary && index < formSpanBoundary) {
              continue;
            }
            formSpanBoundary = findNextIndex(fieldDetails, index, (compare) =>
              fieldDetail.formIndex != compare.formIndex
            );
            td.setAttribute("rowspan", formSpanBoundary - index);

            td.classList.add("field-icon");
            td.classList.add("field-form-icon");
            break;
          }
          case "col-section": {
            if (sectionSpanBoundary && index < sectionSpanBoundary) {
              continue;
            }
            sectionSpanBoundary = findNextIndex(fieldDetails, index, (compare) =>
              fieldDetail.sectionIndex != compare.sectionIndex
            );
            if (sectionSpanBoundary > formSpanBoundary) {
              sectionSpanBoundary = formSpanBoundary;
            }
            td.setAttribute("rowspan", sectionSpanBoundary - index);

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
            if (frameSpanBoundary && index < frameSpanBoundary) {
              continue;
            }
            frameSpanBoundary = findNextIndex(fieldDetails, index, (compare) =>
              fieldDetail.browsingContextId != compare.browsingContextId
            );
            if (frameSpanBoundary > sectionSpanBoundary) {
              frameSpanBoundary = sectionSpanBoundary;
            }
            td.setAttribute("rowspan", frameSpanBoundary - index);

            td.appendChild(document.createTextNode(fieldDetail.frame));
            break;
          }
          default: {
            if (!fieldDetail.isVisible) {
              td.classList.add("autofill-invisible-field");
            }

            // Show different style for fields that we have edited its field name manually.
            if (column.id == "col-fieldName") {
              if (this.#updateFieldNameByInspectId.has(fieldDetail.inspectId)) {
                td.classList.add("changed");
              }
            }

            const text = this.#fieldDetailToColumnValue(column.id, fieldDetail);
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

    document.querySelectorAll(".field-list-table tr").forEach(tr => {
      tr.addEventListener("click", () => {
        const rows = event.target.hasAttribute("rowspan") ?
          getSpannedRows(event.target) : [tr];

        let remove = [];
        let add = [];
        for (const row of rows) {
          row.classList.contains("selected") ?
            remove.push(this.#rowToFieldDetail.get(row)) :
            add.push(this.#rowToFieldDetail.get(row));
          row.classList.toggle("selected");
        }
        this.#removeHighlightOverlay("select", remove);
        this.#addHighlightOverlay("select", add);
      });
    });
  }
}

new AutofillInspector();

