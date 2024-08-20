const INDEX_HTML = "chrome://aboutautofill/content/index.html";

let AboutAutofillRedirector = {
  QueryInterface: ChromeUtils.generateQI([Ci.nsIAboutModule]),
  classID: Components.ID("{1eb3a63d-44e4-4de0-8f01-8c44ade81b49}"),

  getURIFlags() {
    return Ci.nsIAboutModule.ALLOW_SCRIPT;
  },

  newChannel(aURI, aLoadInfo) {
    let newURI = Services.io.newURI(INDEX_HTML);
    let channel = Services.io.newChannelFromURIWithLoadInfo(newURI, aLoadInfo);

    channel.originalURI = aURI;

    return channel;
  },

  createInstance(p1, p2) {
    // Pre Firefox 102, this signature was `createInstance(outer, iid)`
    // In 102 (bug 1514936) it became `createInstance(iid)`.
    let iid = "NS_ERROR_NO_AGGREGATION" in Components.results ? p2 : p1;
    return this.QueryInterface(iid);
  },

  register() {
    const contract = "@mozilla.org/network/protocol/about;1?what=autofill";
    const description = "About Autofill";
    Components.manager.QueryInterface(Ci.nsIComponentRegistrar)
      .registerFactory(this.classID, description, contract, this);
  },

  unregister() {
    Components.manager.QueryInterface(Ci.nsIComponentRegistrar)
      .unregisterFactory(this.classID, this);
  }
};

this.aboutautofill = class extends ExtensionAPI {
  // Ideally we'd be able to implement onUninstall and onUpdate static methods,
  // as described in
  // https://firefox-source-docs.mozilla.org/toolkit/components/extensions/webextensions/lifecycle.html
  // However, this doesn't work for "experiment" APIs - see bug 1485541.

  getAPI(context) {
    const { tabManager } = context.extension;
    return {
      aboutautofill: {
        async startup() {
          let aomStartup = Cc["@mozilla.org/addons/addon-manager-startup;1"]
                               .getService(Ci.amIAddonManagerStartup);
          const manifestURI = Services.io.newURI("manifest.json", null, context.extension.rootURI);
          this.chromeHandle = aomStartup.registerChrome(manifestURI, [
            ["content", "aboutautofill", "data/"],
          ]);
          AboutAutofillRedirector.register();
        },

        async inspect(tabId, elementId) {
          const fieldDetails = [];

          const { browser } = tabManager.get(tabId);
          const topBC = browser.browsingContext.top;
          const contexts = topBC.getAllBrowsingContextsInSubtree();
          for (const context of contexts) {
            const windowGlobal = context.currentWindowGlobal;
            if (!windowGlobal) {
              continue;
            }

            try {
              const actor = windowGlobal.getActor("FormAutofill");
              const details = await actor.sendQuery("FormAutofill:InspectFields");
              if (details?.length) {
                fieldDetails.push(...details);
              }
            } catch {}
          }

          // Notify About:Autofill page
          Services.obs.notifyObservers(
            null,
            "formautofill-inspect-field-result",
            JSON.stringify({ targetElementId: elementId, fieldDetails })
          );
        },
      }
    }
  }
}
