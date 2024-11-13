const INDEX_HTML = "chrome://aboutautofill/content/index.html";

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  WebNavigationFrames: "resource://gre/modules/WebNavigationFrames.sys.mjs",
});


this.aboutautofill = class extends ExtensionAPI {
  // Ideally we'd be able to implement onUninstall and onUpdate static methods,
  // as described in
  // https://firefox-source-docs.mozilla.org/toolkit/components/extensions/webextensions/lifecycle.html
  // However, this doesn't work for "experiment" APIs - see bug 1485541.

  getAPI(context) {
    const { tabManager } = context.extension;
    return {
      aboutautofill: {
        // CaptureTab. V3 Doesn't have this
        async test(tabId, x, y, width, height) {
          const { browser } = tabManager.get(tabId);
          const windowGlobal = browser.browsingContext.currentWindowGlobal;
          const rect = new context.xulBrowser.ownerGlobal.window.DOMRect(x, y, width, height);
          const zoom = browser.browsingContext.fullZoom;
          const scale = browser.browsingContext.topChromeWindow.devicePixelRatio || 1;
          const image = await windowGlobal.drawSnapshot(rect, scale * zoom, "white");
          const canvas = new OffscreenCanvas(image.width, image.height);

          const ctx = canvas.getContext("bitmaprenderer", { alpha: false });
          ctx.transferFromImageBitmap(image);
          const blob = await canvas.convertToBlob({
            type: `image/png`,
          });

          const dataURL = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
          });
          return dataURL;
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

                fieldDetail.frameId = lazy.WebNavigationFrames.getFrameId(bc);
                console.log("[FrameId]" + fieldDetail.frameId);

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
