/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
//import freezeDry from './libs/freeze-dry.es.js'

let gRowToFieldDetailMap = new Map();

function inspectIdToElementSelector(id) {
  return `[data-moz-autofill-inspect-id="${id}"]`;
}
function initAutofillInspectorPanel() {
  browser.runtime.sendMessage({
    msg: "init",
    tabId: browser.devtools.inspectedWindow.tabId,
  });

  const button = document.getElementById("autofill-inspect-start-button");
  button.addEventListener("click", () => {
    browser.runtime.sendMessage({
      msg: "inspect",
      tabId: browser.devtools.inspectedWindow.tabId,
    });
  });

  const inspectElementButton = document.getElementById("autofill-inspect-element-button");
  inspectElementButton.addEventListener("click", () => {
    const row = document.querySelector("tr.selected");
    const fieldDetail = gRowToFieldDetailMap.get(row);
    const js = `
      (function() {
        const selector = '${inspectIdToElementSelector(fieldDetail.inspectId)}'
        inspect(document.querySelector(selector));
      })();
    `;
    browser.devtools.inspectedWindow.eval(js).catch((e) => console.error(e));
  });
  // TODO: Support download + generate testcase

  // TODO: Implement screenshot the selected DOM Element
  const screenshotButton = document.getElementById("autofill-screenshot-button");
  screenshotButton.addEventListener("click", async () => {
    browser.devtools.inspectedWindow.eval(
      `({
          width: document.documentElement.scrollWidth,
          height: document.documentElement.scrollHeight,
      })`, (result) => {
        browser.runtime.sendMessage({
          msg: "screenshot",
          rect: {
            x: 0,
            y: 0,
            width: result.width,
            height: result.height,
          },
          tabId: browser.devtools.inspectedWindow.tabId,
        });
      }
    );
  });

  // TODO: Support iframe, zip everything
  const downloadButton = document.getElementById("autofill-download-button");
  downloadButton.addEventListener("click", async () => {
    browser.runtime.sendMessage({
      msg: "freeze",
      tabId: browser.devtools.inspectedWindow.tabId,
    });
  });


  // TODO: Make the bugzilla to save more fields
  const reportButton = document.getElementById("autofill-report-button");
  reportButton.addEventListener("click", async () => {
    browser.runtime.sendMessage({
      msg: "report",
      tabId: browser.devtools.inspectedWindow.tabId,
    });
  });

  // TODO: Support Read JSON for Test Records
  // TODO: Support dropdown to choose the country for selected address, type for selected credit card
  const addAddressButton = document.getElementById("autofill-add-address-button");
  const addCreditCardButton = document.getElementById("autofill-add-credit-card-button");

  function onAddRecord() {
    const records = [];
    if (addAddressButton.checked) {
      records.push({
        "given-name": "John",
        "additional-name": "R.",
        "family-name": "Smith",
        organization: "World Wide Web Consortium",
        "street-address": "32 Vassar Street\nMIT Room 32-G524",
        "address-level2": "Cambridge",
        "address-level1": "MA",
        "postal-code": "02139",
        country: "US",
        tel: "+16172535702",
        email: "timbl@w3.org",
      });
    };

    if (addCreditCardButton.checked) {
      records.push({
        "cc-name": "John Doe",
        "cc-number": "4111111111111111",
        "cc-exp-month": 4,
        "cc-exp-year": new Date().getFullYear(),
      });
    }

    browser.runtime.sendMessage({
      msg: "set-test-records",
      tabId: browser.devtools.inspectedWindow.tabId,
      records,
    });
  }

  addAddressButton.addEventListener("change", (event) => onAddRecord());
  addCreditCardButton.addEventListener("change", (event) => onAddRecord());

  const exportButton = document.getElementById("autofill-export-button");
  exportButton.addEventListener("click", () => {
    // Use html2Canvas to screenshot
    const element = document.getElementById("autofill-panel");

    const rect = element.getBoundingClientRect();

    const canvas = document.createElement("canvas");
    canvas.width = rect.width;
    canvas.height = rect.height;
    const context = canvas.getContext("2d");

    html2canvas(element).then(canvas => {
      const dataUrl = canvas.toDataURL("image/png");
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = "screenshot.png";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    });
  });

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

function fieldDetailToColumnValue(columnId, fieldDetail) {
  const regex = /^col-(.*)$/;
  const fieldName = columnId.match(regex)[1];
  return fieldDetail[fieldName];
}

function scrollIntoView(fieldDetail) {
  browser.runtime.sendMessage({
    msg: "scroll",
    tabId: browser.devtools.inspectedWindow.tabId,
    inspectId: fieldDetail.inspectId,
    frameId: fieldDetail.frameId,
  });
}

// TODO: FormAutofill uses Inspect Field to mark id for <iframe>
// TODO: We should use overlay div instead of setting backgroud
function addHighlightOverlay(type, fieldDetail) {
  browser.runtime.sendMessage({
    msg: "highlight",
    tabId: browser.devtools.inspectedWindow.tabId,
    type,
    inspectId: fieldDetail.inspectId,
    frameId: fieldDetail.frameId,
  });
}

// Type should be either `select` or `hover`
function removeHighlightOverlay(type, fieldDetail) {
  browser.runtime.sendMessage({
    msg: "highlight-remove",
    tabId: browser.devtools.inspectedWindow.tabId,
    type,
    inspectId: fieldDetail.inspectId,
    frameId: fieldDetail.frameId,
  });
}

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

function setupRowMouseOver(tr, fieldDetail) {
  tr.addEventListener("mouseover", (event) => {
    event.preventDefault();
    if (event.target.hasAttribute("rowspan")) {
      tr.classList.add('className', 'autofill-hide-highlight');
      return;
    }

    addHighlightOverlay("hover", fieldDetail);
    scrollIntoView(fieldDetail);
  });

  tr.addEventListener("mouseout", (event) => {
    event.preventDefault();
    if (event.target.hasAttribute("rowspan")) {
      tr.classList.remove('className', 'autofill-hide-highlight');
      return;
    }

    removeHighlightOverlay("hover", fieldDetail);
  });
}

// Utils
function findNextIndex(array, currentIndex, condition) {
  for (let i = currentIndex + 1; i < array.length; i++) {
    if (condition(array[i])) {
        return i;
    }
  }
  return array.length;
}

function updateFieldsInfo(fieldDetails) {
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

    // Setup the mouse over handler for this row
    gRowToFieldDetailMap.set(tr, fieldDetail);
    setupRowMouseOver(tr, fieldDetail);

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
            fieldDetail.rootIndex != compare.rootIndex
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
    tr.addEventListener("click", function() {
      //if (["col-root", "col-section", "col-frame"].includes(event.target.id)) {
      let rows;
      if (event.target.hasAttribute("rowspan")) {
        rows = getSpannedRows(event.target);
      } else {
        rows = [tr];
      }

      for (const row of rows) {
        if (row.classList.contains("selected")) {
          removeHighlightOverlay("select", gRowToFieldDetailMap.get(row));
        } else {
          addHighlightOverlay("select", gRowToFieldDetailMap.get(row))
        }
        row.classList.toggle("selected");
      }
    });
  });
}

document.addEventListener("DOMContentLoaded", initAutofillInspectorPanel, { once: true });

// Handle requests from background script.
browser.runtime.onMessage.addListener((request) => {
  if (request.tabId != browser.devtools.inspectedWindow.tabId) {
    return;
  }

  switch (request.msg) {
    case 'refresh': {
      updateFieldsInfo(request.data);
      break;
    }
    case 'show': {
      const rows = document.querySelectorAll("tr.selected");
      rows.forEach(row => {
        const fieldDetail = gRowToFieldDetailMap.get(row);
        if (fieldDetail) {
          addHighlightOverlay("select", fieldDetail);
        }
      });
    }
  }
});
