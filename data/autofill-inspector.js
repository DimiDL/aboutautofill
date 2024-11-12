/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
//import freezeDry from './libs/freeze-dry.es.js'

let gRowToFieldDetailMap = new Map();
let gInspectedFieldDetails;

function getAllCreditCardFieldType() {
  return [
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
}

function getAllAddressFieldType() {
 return [
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
}

function fieldDetailsToTestExpectedResult(fieldDetails) {
  const sections = [];
  let rootIndex;
  let sectionIndex;
  for (const fieldDetail of fieldDetails) {
    if (fieldDetail.rootIndex != rootIndex ||
        fieldDetail.sectionIndex != sectionIndex) {
      rootIndex = fieldDetail.rootIndex;
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

async function loadData(filename) {
  try {
    const url = browser.runtime.getURL(filename);
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error("Network response was not ok " + response.statusText);
    }

    let data;
    const extension = url.split('.').pop().toLowerCase();
    if (extension === "json") {
      data = await response.json();
    } else {
      data = await response.text();
    }
    return data;
  } catch (error) {
    console.error("Failed to load JSON data:", error);
  }
}

let gTestAddresses;
async function getTestAddresses() {
  if (!gTestAddresses) {
    gTestAddresses = await loadData("data/test-addresses.json");
  }
  return gTestAddresses;
}

let gTestCreditCards;
async function getTestCreditCards() {
  if (!gTestCreditCards) {
    gTestCreditCards = await loadData("data/test-credit-cards.json");
  }
  return gTestCreditCards;
}

async function getTestTemplate() {
  return await loadData("data/gecko-autofill-test-template.js");
}

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
    gInspectedFieldDetails = null;
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
  // -- attach screenshot
  // -- attach testcase
  // -- attach claasified result
  // -- attach downloaded file
  const reportButton = document.getElementById("autofill-report-button");
  reportButton.addEventListener("click", async () => {
    browser.runtime.sendMessage({
      msg: "report",
      tabId: browser.devtools.inspectedWindow.tabId,
    });
  });

  let editing = false;
  const editFieldButton = document.getElementById("autofill-edit-field-button");
  editFieldButton.addEventListener("click", async (event) => {
    let hasChanged = false;
    const isEditing = editFieldButton.classList.contains("editing");
    const editables = document.querySelectorAll("td#col-fieldName");
    editables.forEach(cell => {
      if (isEditing) {
        const select = cell.querySelector("select");
        if (select.classList.contains("changed")) {
          hasChanged = true;
          const tr = select.closest("tr");
          const fieldDetail = gRowToFieldDetailMap.get(tr);
          browser.runtime.sendMessage({
            msg: "change-field-attribute",
            tabId: browser.devtools.inspectedWindow.tabId,
            frameId: fieldDetail.frameId,
            inspectId: fieldDetail.inspectId,
            attribute: "autocomplete",
            value: select.value,
          });
        }
        cell.textContent = select.value;
        select.remove();
      } else {
        const select = document.createElement("select");

        const options = [...getAllAddressFieldType(), ...getAllCreditCardFieldType()];
        options.forEach(optionText => {
          const option = document.createElement("option");
          option.value = optionText;
          option.textContent = optionText;
          if (optionText === cell.textContent) {
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
    if (isEditing && hasChanged) {
      // Send a message to run inspect again
      gInspectedFieldDetails = null;
      browser.runtime.sendMessage({
        msg: "inspect",
        tabId: browser.devtools.inspectedWindow.tabId,
      });
    }
    editFieldButton.classList.toggle("editing");
  });

  const generateTestButton = document.getElementById("autofill-generate-test-button");
  generateTestButton.addEventListener("click", async () => {
    const template = await getTestTemplate();
    const result = fieldDetailsToTestExpectedResult(gInspectedFieldDetails);
    browser.runtime.sendMessage({
      msg: "generate-testcase",
      tabId: browser.devtools.inspectedWindow.tabId,
      template,
      result,
    });
  });

  const addAddressButton = document.getElementById("autofill-add-address-button");
  const addCreditCardButton = document.getElementById("autofill-add-credit-card-button");

  async function onAddRecord() {
    const records = [];
    if (addAddressButton.checked) {
      const addresses = await getTestAddresses();
      records.push(...addresses);
    };

    if (addCreditCardButton.checked) {
      const creditcards = await getTestCreditCards();
      records.push(...creditcards);
    }

    browser.runtime.sendMessage({
      msg: "set-test-records",
      tabId: browser.devtools.inspectedWindow.tabId,
      records,
    });
  }

  addAddressButton.addEventListener("change", (event) => onAddRecord());
  addCreditCardButton.addEventListener("change", (event) => onAddRecord());

  // TODO: Maybe we should just export the HTML?
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
  // Clone the field detail array
  gInspectedFieldDetails = Array.from(fieldDetails, item => ({ ...item }));

  const tbody = document.getElementById("form-analysis-table-body");
  while (tbody.firstChild) {
    tbody.firstChild.remove();
  }

  const cols = document.getElementById("form-analysis-head-row").childNodes;
  let nthSection = -1;

  let formNextIndex;
  let sectionNextIndex;
  let frameNextIndex;

  for (let index = 0; index < gInspectedFieldDetails?.length; index++) {
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
    case 'inspect_complete': {
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
