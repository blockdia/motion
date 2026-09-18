export function showLoading(status: HTMLElement, text: string, runtimeUrl: string) {
  const stylesheet = new URL('loading.css', runtimeUrl).href;
  if (
    ![...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')].some(
      (link) => link.href === stylesheet,
    )
  ) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = stylesheet;
    document.head.append(link);
  }
  status.classList.add('motion-loading');
  const blocks = document.createElement('span');
  blocks.className = 'motion-loading-blocks';
  blocks.setAttribute('aria-hidden', 'true');
  for (const name of ['top', 'middle', 'bottom']) {
    const image = document.createElement('img');
    image.src = new URL(`loading/${name}-block.svg`, runtimeUrl).href;
    image.alt = '';
    image.draggable = false;
    image.className = `motion-loading-${name}`;
    blocks.append(image);
  }
  const label = document.createElement('span');
  label.textContent = text;
  status.replaceChildren(blocks, label);
}
