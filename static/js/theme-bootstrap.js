(function applySavedTheme() {
  const savedTheme = sessionStorage.getItem('theme');
  const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.classList.toggle(
    'dark',
    savedTheme === 'dark' || (!savedTheme && systemPrefersDark),
  );

  const palettes = [
    'theme-blue',
    'theme-green',
    'theme-purple',
    'theme-teal',
    'theme-rose',
    'theme-orange',
  ];
  let selectedPalette = sessionStorage.getItem('selected-palette');
  if (!palettes.includes(selectedPalette)) {
    selectedPalette = palettes[Math.floor(Math.random() * palettes.length)];
    sessionStorage.setItem('selected-palette', selectedPalette);
  }
  document.documentElement.classList.add(selectedPalette);
})();
