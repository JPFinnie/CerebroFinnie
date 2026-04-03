export function renderObsidianMarkdown(markdown: string) {
  return markdown
    .replace(/!\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g, (_, target, label) => {
      return `> Attachment: ${label || target}`;
    })
    .replace(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g, (_, target, label) => {
      return label || target.split('/').pop() || target;
    });
}
