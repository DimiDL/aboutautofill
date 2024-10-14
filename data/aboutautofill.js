/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const { FormAutofill } = ChromeUtils.importESModule(
  "resource://autofill/FormAutofill.sys.mjs"
);

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  FormAutofillSection:
    "resource://gre/modules/shared/FormAutofillSection.sys.mjs",
});

// Lazily load the storage JSM to avoid disk I/O until absolutely needed.
// Once storage is loaded we need to update saved field names and inform content processes.
ChromeUtils.defineLazyGetter(lazy, "gFormAutofillStorage", () => {
  let { formAutofillStorage } = ChromeUtils.importESModule(
    "resource://autofill/FormAutofillStorage.sys.mjs"
  );
  formAutofillStorage.initialize();

  return formAutofillStorage;
});

const TEST_ADDRESS = {
  "given-name": "About",
  "additional-name": "R.",
  "family-name": "Autofill",
  organization: "Mozilla",
  "street-address": "149 New Montgomery Street",
  "address-level2": "San Francisco",
  "address-level1": "CA",
  "postal-code": "94105",
  country: "US",
  tel: "+16172535702",
  email: "aboutautofill@mozilla.org",
};

const TEST_CREDIT_CARD = {
  "cc-name": "About Autofill",
  "cc-number": "4111111111111111",
  "cc-exp-month": 4,
  "cc-exp-year": new Date().getFullYear(),
};

let gAboutAutofill;
window.onload = function () {
  if (!gAboutAutofill) {
    gAboutAutofill = new AboutAutofill();
  }
};
window.onunload = function () {
  gAboutAutofill?.uninit();
};

class AboutAutofill {
  #FEATURES = ["addresses", "creditCards"];

  constructor() {
    Services.obs.addObserver(this, "formautofill-inspect-field-result");

    this.initHeaderPanel();
    this.initFeatureSettingPanel();
    this.initFieldInfoPanel();
    this.initDebugUtilityPanel();
  }

  uninit() {
    Services.obs.removeObserver(this, "formautofill-inspect-field-result");
  }

  observe(_subject, topic, data) {
    switch (topic) {
      case "formautofill-inspect-field-result": {
        const { targetElementId, fieldDetails } = JSON.parse(data);
        this.onInspectorResult(targetElementId, fieldDetails);
        break;
      }
      default:
        break;
    }
  }

  /**
   * Header Panel
   */
  initHeaderPanel() {
    const button = document.getElementById("autofill-inspector-enable-button");
    button.addEventListener("click", () => {
      const enabled = FormAutofill.isInspectorEnabled;
      Services.prefs.setBoolPref(
        FormAutofill.ENABLED_AUTOFILL_INSPECTOR,
        !enabled
      );

      this.updateHeaderPanel();
    });

    this.updateHeaderPanel();
  }

  updateHeaderPanel() {
    const button = document.getElementById("autofill-inspector-enable-button");
    const statusText = FormAutofill.isInspectorEnabled ? "Disable" : "Enable";
    button.textContent = `${statusText} Autofill Inspector in Context Menu`;
  }

  /**
   * Feature Setting Panel
   */
  initFeatureSettingPanel() {
    this.updateFeatureSettingPanel();
  }

  updateFeatureSettingPanel() {
    const tbody = document.getElementById("autofill-feature-table-body");
    while (tbody.firstChild) {
      tbody.firstChild.remove();
    }

    for (const feature of this.#FEATURES) {
      const tr = document.createElement("tr");
      const cols = document.getElementById(
        "autofill-feature-head-row"
      ).childNodes;
      for (const column of cols) {
        if (!column.id) {
          continue;
        }

        let element;
        const text = this.featureColumnToText(feature, column.id);

        if (column.id == "col-feature-toggle") {
          element = document.createElement("button");
          element.id = feature;
          element.textContent = text;
          element.addEventListener("click", e =>
            this.onFeatureToggleClicked(e)
          );
        } else {
          element = document.createTextNode(text);
        }

        const td = document.createElement("td");
        td.appendChild(element);
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
  }

  isFeatureEnabled(feature) {
    return feature == "addresses"
      ? FormAutofill.isAutofillAddressesEnabled
      : FormAutofill.isAutofillCreditCardsEnabled;
  }

  featureColumnToText(feature, column) {
    switch (column) {
      case "col-feature":
        return feature;
      case "col-supported-mode":
        return Services.prefs.getCharPref(
          `extensions.formautofill.${feature}.supported`
        );
      case "col-supported-region":
        return Services.prefs.getCharPref(
          `extensions.formautofill.${feature}.supportedCountries`
        );
      case "col-current-status":
        return this.isFeatureEnabled(feature);
      case "col-feature-toggle": {
        const mode = this.isFeatureEnabled(feature) ? "on" : "off";
        return `Turn ${mode} autofill`;
      }
      default:
        return undefined;
    }
  }

  onFeatureToggleClicked(evt) {
    const feature = evt.target.id;
    const mode = !this.isFeatureEnabled(feature) ? "on" : "off";

    Services.prefs.setCharPref(
      `extensions.formautofill.${feature}.supported`,
      mode
    );
    this.updateFeatureSettingPanel();
  }

  /**
   * Field Information Panel
   */

  initFieldInfoPanel() {
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

  classifyAnalysisResult(fields) {
    const fieldsByRoot = {};
    const rootOrder = [];
    fields.forEach(field => {
      if (fieldsByRoot[field.rootElementId]) {
        fieldsByRoot[field.rootElementId].push(field);
      } else {
        fieldsByRoot[field.rootElementId] = [field];
        rootOrder.push(field.rootElementId);
      }

      field.rootIndex = rootOrder.indexOf(field.rootElementId);
    });

    for (const fieldDetails of Object.values(fieldsByRoot)) {
      lazy.FormAutofillSection.classifySections(fieldDetails).forEach(
        (section, sectionIndex) => {
          section.fieldDetails.forEach(field => {
            field.sectionIndex = sectionIndex;
          });
        }
      );
    }

    return fields;
  }

  fieldDetailToColumnValue(columnId, fieldDetail) {
    const regex = /^col-(.*)$/;
    const fieldName = columnId.match(regex)[1];
    return fieldDetail[fieldName];
  }

  onInspectorResult(targetElementId, fieldDetails) {
    this.targetId = JSON.stringify(targetElementId);
    this.inspectionResult = this.classifyAnalysisResult(fieldDetails);

    this.updateFieldsInfo(this.targetId, this.inspectionResult);
  }

  filterFields(fieldDetail) {
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

  updateFieldsInfo(targetId, fieldDetails) {
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
            const bc = BrowsingContext.get(fieldDetail.browsingContextId);
            if (bc == bc.top) {
              text = "Main Frame";
            } else {
              const host = bc.currentWindowGlobal.documentPrincipal.host;
              if (this.isSameOriginWithTop(bc)) {
                text = `Same Origin Iframe - ${host}\n${fieldDetail.identifier}`;
              } else {
                text = `Cross Origin Iframe - ${host}\n${fieldDetail.identifier}`;
              }
            }
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

  isSameOriginWithTop(bc) {
    return bc.currentWindowGlobal.documentPrincipal.equals(
      bc.top.currentWindowGlobal.documentPrincipal
    );
  }

  /**
   * Debug Panel
   */
  initDebugUtilityPanel() {
    let element = document.getElementById("jslog");
    element.checked = false;
    element.addEventListener("click", e => this.onEnableJSLog(e));

    element = document.getElementById("add-address-profile");
    element.checked = false;
    element.addEventListener("click", e => this.onAddAddressProfile(e));

    element = document.getElementById("add-credit-card-profile");
    element.checked = false;
    element.addEventListener("click", e => this.onAddCreditCardProfile(e));
  }

  onEnableJSLog(evt) {
    const mode = evt.target.checked ? "Debug" : "Warn";
    Services.prefs.setCharPref(`extensions.formautofill.loglevel`, mode);
  }

  // TODO: May create a duplicate address
  async onAddAddressProfile(evt) {
    const storage = lazy.gFormAutofillStorage.addresses;
    if (evt.target.checked && !this.addressGUID) {
      this.addressGUID = await storage.add(TEST_ADDRESS);
    } else if (!evt.target.checked && this.addressGUID) {
      await storage.remove(this.addressGUID);
      this.addressGUID = null;
    }
  }

  // TODO: May create a duplicate credit card
  async onAddCreditCardProfile(evt) {
    const storage = lazy.gFormAutofillStorage.creditCards;
    if (evt.target.checked && !this.creditCardGUID) {
      this.creditCardGUID = await storage.add(TEST_CREDIT_CARD);
    } else if (!evt.target.checked && this.creditCardGUID) {
      await storage.remove(this.creditCardGUID);
      this.creditCardGUID = null;
    }
  }
}
