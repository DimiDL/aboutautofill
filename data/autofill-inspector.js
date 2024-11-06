/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

function initAutofillInspectorPanel() {
  const button = document.getElementById("autofill-inspect-start-button");
  button.addEventListener("click", () => {
    browser.runtime.sendMessage({
      tabId: browser.devtools.inspectedWindow.tabId,
    });
  });

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

  const headers = [ {id: "col-root", text: "Root"},
    {id: "col-section", text: "Section"},
    {id: "col-frame", text: "Frame"},
    {id: "col-identifier", text: "Id/Name"},
    {id: "col-fieldName", text: "FieldName"},
    {id: "col-reason", text: "Reason"},
    {id: "col-isVisible", text: "Visible"},
    {id: "col-part", text: "Part"},
    {id: "col-confidence", text: "Confidence"},
  ];

  const head = document.getElementById("form-analysis-head-row");
  headers.forEach(header => {
    const td = document.createElement("td");
    td.setAttribute("id", header.id);
    td.setAttribute("class", "treeHeaderCell");
    const div = document.createElement("div");
    div.setAttribute("class", "treeHeaderCellBox");
    div.innerHTML = header.text;
    td.appendChild(div);
    head.appendChild(td);
  });
}

function fieldDetailToColumnValue(columnId, fieldDetail) {
  const regex = /^col-(.*)$/;
  const fieldName = columnId.match(regex)[1];
  return fieldDetail[fieldName];
}

function updateFieldsInfo(targetId, fieldDetails) {
  if (!fieldDetails) {
    return;
  }

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
    tr.setAttribute("class", "treeRow");

    const [id, name] = fieldDetail.identifier.split("/");
    const selector = `[data-autofill-inspect-id="${JSON.parse(fieldDetail.elementId).id}"]`;
    tr.addEventListener("mouseover", (event) => {
      if (event.target.hasAttribute("rowspan")) {
        tr.classList.add('className', 'autofill-hide-highlight');
        return;
      }

      event.preventDefault();
      const js = `
        (function() {
          function scrollToElementIfNotInView(element) {
            const rect = element.getBoundingClientRect();
            const isInViewport = (
              rect.top >= 0 &&
              rect.left >= 0 &&
              rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
              rect.right <= (window.innerWidth || document.documentElement.clientWidth)
            );

            if (!isInViewport) {
              element.scrollIntoView({behavior: 'smooth', block: 'center', inline: 'nearest'});
            }
          }

          const element = document.querySelector('${selector}');
          if (!element) {
            const iframes = doc.querySelectorAll("iframe");
            for (let iframe of iframes) {
              element = document.querySelector('${selector}');
              if (element) {
                break;
              }
            }
          }

          if (element) {
            element.setAttribute('data-original-bg', window.getComputedStyle(element).backgroundColor);
            element.style.backgroundColor = 'lightblue';
            scrollToElementIfNotInView(element);
          }
        })();
      `;
      browser.devtools.inspectedWindow.eval(js).catch((e) => console.error(e));
    });

    tr.addEventListener("mouseout", (event) => {
      if (event.target.hasAttribute("rowspan")) {
        tr.classList.remove('className', 'autofill-hide-highlight');
        return;
      }

      event.preventDefault();
      const js = `
        (function() {
          const element = document.querySelector('${selector}');
          if (!element) {
            const iframes = doc.querySelectorAll("iframe");
            for (let iframe of iframes) {
              element = document.querySelector('${selector}');
              if (element) {
                break;
              }
            }
          }
          if (element) {
            if (element && element.hasAttribute('data-original-bg')) {
              // Reset to the original background color
              element.style.backgroundColor = element.getAttribute('data-original-bg');
              element.removeAttribute('data-original-bg');
            }
          }
        })();
      `;
      browser.devtools.inspectedWindow.eval(js).catch((e) => console.error(e));
    });

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
          td.setAttribute("rowspan", rootRowCount);
          td.setAttribute("class", "autofillForm");
          rootRowSpan = true;
          break;
        case "col-section":
          if (sectionRowSpan) {
            continue;
          }
          if (fieldDetail.fieldName.startsWith("cc-")) {
            td.setAttribute("class", "creditCardSection");
          } else {
            td.setAttribute("class", "addressSection");
          }
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

      if (text) {
        td.appendChild(document.createTextNode(text));
      }
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
  if (request.tabId != browser.devtools.inspectedWindow.tabId) {
    return;
  }

  if (request.type === 'refresh') {
    const json = JSON.stringify(request.data);
    updateFieldsInfo(null, request.data)
  }
});
