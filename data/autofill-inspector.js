/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */


function initAutofillInspectorPanel() {
  const button = document.getElementById("autofill-inspect-start-button");
  button.addEventListener("click", () => {
    console.log("[Dimi]StartInspect");
    browser.runtime.sendMessage({
      tabId: browser.devtools.inspectedWindow.tabId,
    });
  });

  let element = document.getElementById("field-info-filter-by-visibility");
  element.checked = true;
  element.addEventListener("click", () =>
    this.updateFieldsInfo(this.targetId, this.inspectionResult)
  );

  element = document.getElementById("field-info-filter-by-validity");
  element.checked = false;
  element.addEventListener("click", () =>
    this.updateFieldsInfo(this.targetId, this.inspectionResult)
  );
}

function fieldDetailToColumnValue(columnId, fieldDetail) {
  const regex = /^col-(.*)$/;
  const fieldName = columnId.match(regex)[1];
  return fieldDetail[fieldName];
}

function filterFields(fieldDetail) {
  let element = document.getElementById("field-info-filter-by-visibility");
  if (!fieldDetail.isVisible && !element.checked) {
    return false;
  }

  element = document.getElementById("field-info-filter-by-validity");
  if (!fieldDetail.fieldName && !element.checked) {
    return false;
  }
  return true;
}

function updateFieldsInfo(targetId, fieldDetails) {
  if (!fieldDetails) {
    return;
  }
  fieldDetails = fieldDetails.filter(field => this.filterFields(field));

  const tbody = document.getElementById("form-analysis-table-body");
  while (tbody.firstChild) {
    tbody.firstChild.remove();
  }

  const cols = document.getElementById("form-analysis-head-row").childNodes;

  let rootRowCount = 0;
  let rootRowSpan = false;

  let sectionRowCount = 0;
  let sectionRowSpan = false;

  let frameRowCount = 0;
  let frameRowSpan = false;
  for (let index = 0; index < fieldDetails.length; index++) {
    const fieldDetail = fieldDetails[index];

    const tr = document.createElement("tr");

    if (rootRowCount == 0) {
      const current = fieldDetail.rootIndex;
      const fieldsAfter = fieldDetails.slice(index + 1);
      const nextIndex = fieldsAfter.findIndex(
        field => field.rootIndex != current
      );
      rootRowCount = nextIndex == -1 ? fieldsAfter.length + 1 : nextIndex + 1;
      rootRowSpan = false;
    }
    if (sectionRowCount == 0) {
      const current = fieldDetail.sectionIndex;
      const fieldsAfter = fieldDetails.slice(index + 1);
      const nextIndex = fieldsAfter.findIndex(
        field =>
          field.sectionIndex != current && field.sectionIndex != undefined
      );
      sectionRowCount =
        nextIndex == -1 ? fieldsAfter.length + 1 : nextIndex + 1;
      sectionRowCount = Math.min(sectionRowCount, rootRowCount);
      sectionRowSpan = false;
    }
    if (frameRowCount == 0) {
      const current = fieldDetail.browsingContextId;
      const fieldsAfter = fieldDetails.slice(index + 1);
      const nextIndex = fieldsAfter.findIndex(
        field => field.browsingContextId != current
      );
      frameRowCount =
        nextIndex == -1 ? fieldsAfter.length + 1 : nextIndex + 1;
      frameRowCount = Math.min(frameRowCount, sectionRowCount);
      frameRowSpan = false;
    }

    for (const column of cols) {
      if (!column.id) {
        continue;
      }
      const td = document.createElement("td");

      let text;
      switch (column.id) {
        case "col-root":
          if (rootRowSpan) {
            continue;
          }
          text = `Form ${fieldDetail.rootIndex}`;
          td.setAttribute("rowspan", rootRowCount);
          rootRowSpan = true;
          break;
        case "col-section":
          if (sectionRowSpan) {
            continue;
          }
          text = `Section ${fieldDetail.sectionIndex}`;
          td.setAttribute("rowspan", sectionRowCount);
          sectionRowSpan = true;
          break;
        case "col-frame": {
          if (frameRowSpan) {
            continue;
          }
          text = fieldDetail.frame;
          td.setAttribute("rowspan", frameRowCount);
          frameRowSpan = true;
          break;
        }
        default: {
          // Should replace with css
          if (fieldDetail.elementId == this.targetId) {
            td.setAttribute("class", "autofill-target-field");
          }
          if (!fieldDetail.isVisible) {
            td.setAttribute("class", "autofill-invisible-field");
          }

          text = this.fieldDetailToColumnValue(column.id, fieldDetail);
          break;
        }
      }

      td.appendChild(document.createTextNode(text));
      tr.appendChild(td);
    }
    rootRowCount--;
    sectionRowCount--;
    frameRowCount--;
    tbody.appendChild(tr);
  }
}

document.addEventListener("DOMContentLoaded", initAutofillInspectorPanel, { once: true });

// Handle requests from background script.
browser.runtime.onMessage.addListener((request) => {
  if (request.type === 'refresh') {
    const json = JSON.stringify(request.data);
    updateFieldsInfo(null, request.data)
  }
});
