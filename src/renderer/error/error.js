(function() {
  const params = new URLSearchParams(window.location.search);
  document.getElementById('url-display').textContent =
    params.get('url') || 'Unknown URL';
  document.getElementById('error-display').textContent =
    params.get('error') || 'Failed to load page';
})();
