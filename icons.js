// All action glyphs share the same 24px view box and stroke geometry.
const paths = {
  check: '<path d="m5 12 5 5 9-10"/>',
  fuzzy: '<path d="M4 9c4-6 12 6 16 0M4 15c4-6 12 6 16 0"/>',
  question: '<path d="M9 9a3 3 0 1 1 5 2.2c-1.1.8-2 1.3-2 2.8"/><circle cx="12" cy="18" r=".6" fill="currentColor" stroke="none"/>',
  star: '<path d="m12 3 2.8 5.8 6.4.9-4.6 4.5 1.1 6.4L12 17.6l-5.7 3 1.1-6.4-4.6-4.5 6.4-.9L12 3Z"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  up: '<path d="M12 19V5m-6 6 6-6 6 6"/>',
  down: '<path d="M12 5v14m-6-6 6 6 6-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  book: '<path d="M12 6c-3-2-6-2-9-1v14c3-1 6-1 9 1 3-2 6-2 9-1V5c-3-1-6-1-9 1Zm0 0v14"/>',
  play: '<path d="m8 5 11 7-11 7V5Z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  stop: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
  sound: '<path d="M3 9v6h4l5 4V5L7 9H3Zm13 0a5 5 0 0 1 0 6m3-9a9 9 0 0 1 0 12"/>',
  bulb: '<path d="M9 18h6m-6 3h6M8 14a6 6 0 1 1 8 0c-1 .8-1 1.4-1 2H9c0-.6 0-1.2-1-2Z"/>',
};
const gear = Array.from({ length: 32 }, (_, index) => {
  const angle = (index - 0.5) * Math.PI / 16;
  const radius = index % 4 < 2 ? 10 : 8;
  return `${(12 + radius * Math.cos(angle)).toFixed(2)},${(12 + radius * Math.sin(angle)).toFixed(2)}`;
}).join(" ");
paths.settings = `<polygon points="${gear}"/><circle cx="12" cy="12" r="3.2"/>`;

export function icon(name) {
  return `<svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">${paths[name] || paths.check}</svg>`;
}

export function renderStaticIcons(root = document) {
  root.querySelectorAll("[data-icon]").forEach((element) => { element.innerHTML = icon(element.dataset.icon); });
}
