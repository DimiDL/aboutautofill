const INDEX_HTML = "chrome://aboutautofill/content/index.html";

this.aboutautofill = class extends ExtensionAPI {
  // Ideally we'd be able to implement onUninstall and onUpdate static methods,
  // as described in
  // https://firefox-source-docs.mozilla.org/toolkit/components/extensions/webextensions/lifecycle.html
  // However, this doesn't work for "experiment" APIs - see bug 1485541.

  getAPI(context) {
    const { tabManager } = context.extension;
    return {
      aboutautofill: {
        async test() {
          const cwg = context.browsingContext.currentWindowGlobal;
          const rect = new context.xulBrowser.ownerGlobal.window.DOMRect(0, 0, 1300, 1500);
          const snapshot = await cwg.drawSnapshot(rect, 1, "white");
          const document = context.browsingContext.topChromeWindow.document;
          const canvas = document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
          const ctx = canvas.getContext("2d");
          ctx.drawImage(snapshot, 0, 0, 1300, 1500);
          snapshot.close();
          return canvas.toDataURL("image/png", "");
        },

        async inspect(tabId) {

          const { browser } = tabManager.get(tabId);
          const topBC = browser.browsingContext.top;
          const windowGlobal = topBC.currentWindowGlobal;
          if (!windowGlobal) {
            return;
          }

          const actor = windowGlobal.getActor("FormAutofill");
          const roots = await actor.inspectFields();

          const fieldDetails = [];
          const bcs = topBC.getAllBrowsingContextsInSubtree();
          for (const root of roots) {
            const rootIndex = roots.indexOf(root);
            for (const section of root) {
              const sectionIndex = root.indexOf(section);
              section.fieldDetails.forEach(fd => fd.rootIndex = rootIndex);
              section.fieldDetails.forEach(fd => fd.sectionIndex = sectionIndex);

              for (const fieldDetail of section.fieldDetails) {
                const bc = bcs.find(bc => bc.id == fieldDetail.browsingContextId);
                const host = bc.currentWindowGlobal.documentPrincipal.host;

                if (!bc || bc == bc.top) {
                  fieldDetail.frame = `(M) ${host}`;
                } else if (bc.currentWindowGlobal.documentPrincipal.equals(
                    bc.top.currentWindowGlobal.documentPrincipal)) {
                  fieldDetail.frame = `(S) ${host}`;
                } else {
                  fieldDetail.frame = `(C) ${host}`;
                }
              }
              fieldDetails.push(...section.fieldDetails);
            }
          }

          console.log("[Dimi]Fields are " + fieldDetails.map(f => f.fieldName));
          return fieldDetails;
        },

        async setTestRecords(tabId, records) {
          const { browser } = tabManager.get(tabId);
          const windowGlobal = browser.browsingContext.currentWindowGlobal;
          if (!windowGlobal) {
            return;
          }

          const actor = windowGlobal.getActor("FormAutofill");
          await actor.setTestRecords(records);
        },

      }
    }
  }
}
