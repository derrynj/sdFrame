(function() {
  const params = new URLSearchParams(window.location.search);
  const frameId = params.get('frameId') || '';
  const handle = document.getElementById('sdframe-drag-handle');
  const frameName = document.querySelector('.frame-id');
  const unsnapButton = document.querySelector('.unsnap-btn');
  const retryButton = document.querySelector('.retry-btn');
  const retryCountdown = document.querySelector('.retry-countdown');
  const minimizeButton = document.querySelector('.minimize-btn');
  const disableButton = document.querySelector('.disable-btn');
  const menuButton = document.querySelector('.menu-btn');

  frameName.textContent = params.get('name') || frameId.slice(0, 8);
  function getContrastTextColor(color) {
    const channels = color.match(/^#([0-9a-f]{6})$/i);
    if (!channels) return '#ffffff';

    const rgb = channels[1].match(/.{2}/g).map(value => parseInt(value, 16) / 255);
    const linear = rgb.map(channel => channel <= 0.04045
      ? channel / 12.92
      : Math.pow((channel + 0.055) / 1.055, 2.4));
    const luminance = 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
    const whiteContrast = 1.05 / (luminance + 0.05);
    const darkLuminance = 0.0056;
    const blackContrast = (luminance + 0.05) / (darkLuminance + 0.05);
    return blackContrast >= whiteContrast ? '#111111' : '#ffffff';
  }

  function setTitlebarColor(color) {
    if (!/^#[0-9a-f]{6}$/i.test(color)) return;
    const foreground = getContrastTextColor(color);
    handle.style.setProperty('--titlebar-foreground', foreground);
    handle.style.setProperty('--titlebar-control-background',
      foreground === '#ffffff' ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.16)');
    handle.style.setProperty('--titlebar-control-hover',
      foreground === '#ffffff' ? 'rgba(255,255,255,0.32)' : 'rgba(0,0,0,0.24)');
    handle.style.setProperty('--titlebar-text-shadow',
      foreground === '#ffffff' ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.65)');
    handle.style.background = 'linear-gradient(to bottom, ' + color + 'dd, ' + color + '88)';
  }

  setTitlebarColor(params.get('color') || '#444444');
  unsnapButton.style.display = params.get('snapped') === 'true' ? 'inline-block' : 'none';

  unsnapButton.addEventListener('click', function() {
    window.sdFrame.frame.unsnap({ id: frameId, all: true });
  });
  retryButton.addEventListener('click', function() {
    window.sdFrame.page.retry(frameId);
  });
  minimizeButton.addEventListener('click', function() {
    window.sdFrame.frame.minimize();
  });
  disableButton.addEventListener('click', function() {
    window.sdFrame.frame.disable();
  });
  menuButton.addEventListener('click', function(event) {
    event.preventDefault();
    event.stopPropagation();
    window.sdFrame.tray.showMenu(event.clientX, event.clientY);
  });
  window.sdFrame.on.snapStatusChanged(function(data) {
    unsnapButton.style.display = data.isSnapped ? 'inline-block' : 'none';
  });
  window.sdFrame.on.colorChanged(function(data) {
    setTitlebarColor(data.color);
  });
  window.sdFrame.on.loadStatusChanged(function(data) {
    retryButton.hidden = !data.retryAvailable;
    retryCountdown.textContent = data.retryCountdown;
    retryCountdown.hidden = !data.retryCountdown;
  });
  window.sdFrame.on.showBorder(function() {
    handle.classList.add('focused');
  });
  window.sdFrame.on.hideBorder(function() {
    handle.classList.remove('focused');
  });
})();
