// Puts the last chosen theme on the page before anything is drawn, so a light board doesn't flash dark first.
// (A separate file: Cockpit's page allows no inline scripts. web/src/theme.ts keeps it in step afterwards.)
;(function () {
  var theme = 'system'
  try {
    theme = localStorage.getItem('cockpit.theme') || 'system'
  } catch (e) {}
  var light = theme === 'light' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: light)').matches)
  var root = document.documentElement
  root.setAttribute('data-theme', light ? 'light' : 'dark')
  if (light) root.classList.remove('dark')
})()
