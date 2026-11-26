// Apply the workspace appearance before React mounts to avoid a light flash.
(function () {
  document.documentElement.dataset.theme = 'dark';
  try { localStorage.removeItem('netbet.workspace.theme'); } catch (_) {}
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = '#151817';
})();
