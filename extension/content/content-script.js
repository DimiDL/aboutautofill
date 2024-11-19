console.log(`Content Script loaded`);
browser.runtime.onMessage.addListener(data => {
  if (data.message == 'content-freeze-page') {
    const url = browser.runtime.getURL("libs/freeze-dry.es.js");
    import(url).then(async module => {
      const html = await module.freezeDry(document, {});
      const msg = "content-freeze-complete";
      browser.runtime.sendMessage({ msg, html });
    });
  }
});
