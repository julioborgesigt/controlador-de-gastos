try {
  if (localStorage.getItem("theme") === "dark") {
    document.documentElement.dataset.theme = "dark";
    document.documentElement.style.colorScheme = "dark";
  }
} catch {
  /* o tema padrão segue claro */
}
