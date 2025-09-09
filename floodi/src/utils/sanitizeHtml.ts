// Lightweight HTML sanitizer for client-side rendering without external deps.
// Strategy: parse HTML, remove disallowed tags/attributes, neutralize URLs.
// Allows a conservative subset commonly used in rich text comments.

const ALLOWED_TAGS = new Set([
  'b', 'strong', 'i', 'em', 'u', 's', 'sub', 'sup', 'br', 'p', 'ul', 'ol', 'li',
  'blockquote', 'code', 'pre', 'span', 'a'
]);

const ALLOWED_ATTRS: Record<string, Set<string>> = {
  a: new Set(['href', 'title', 'target', 'rel']),
  span: new Set(['style']),
  p: new Set(['style']),
  code: new Set(['class']),
  pre: new Set(['class']),
};

const SAFE_URI_PROTOCOLS = ['http:', 'https:', 'mailto:'];

function isSafeUrl(url: string): boolean {
  try {
    const u = new URL(url, 'http://x');
    return SAFE_URI_PROTOCOLS.includes(u.protocol);
  } catch {
    // Treat relative links as safe; they resolve against current origin in render
    return !/^(javascript:|data:|vbscript:)/i.test(url);
  }
}

export function sanitizeHtml(dirty: string | null | undefined): string {
  if (!dirty) return '';
  const doc = globalThis?.document;
  if (!doc) {
    // Non-browser environment fallback: strip tags crudely
    return String(dirty).replace(/<[^>]*>/g, '');
  }
  const tpl = doc.createElement('template');
  tpl.innerHTML = String(dirty);

  const walk = (node: Node) => {
    // Remove script/style/comment nodes entirely
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      const tag = el.tagName.toLowerCase();
      if (!ALLOWED_TAGS.has(tag)) {
        // Replace disallowed element with its text content
        const parent = el.parentNode;
        while (el.firstChild) parent?.insertBefore(el.firstChild, el);
        parent?.removeChild(el);
        return; // children already moved up
      }
      // Scrub attributes
      [...el.attributes].forEach((attr) => {
        const name = attr.name.toLowerCase();
        const value = attr.value;
        const allowedForTag = ALLOWED_ATTRS[tag];
        const isAllowed = allowedForTag?.has(name) ?? false;
        if (!isAllowed) {
          el.removeAttribute(attr.name);
          return;
        }
        // Special handling
        if (tag === 'a' && name === 'href') {
          if (!isSafeUrl(value)) {
            el.removeAttribute('href');
          } else {
            // Ensure safe link behavior
            el.setAttribute('rel', 'noopener noreferrer nofollow');
            if (!el.getAttribute('target')) el.setAttribute('target', '_blank');
          }
        }
        if (name === 'style') {
          // Very conservative: allow only color-related styles
          const safe = value
            .split(';')
            .map((s) => s.trim())
            .filter((s) => /^(color|background-color|font-weight|font-style|text-decoration)\s*:/i.test(s))
            .join('; ');
          if (safe) el.setAttribute('style', safe);
          else el.removeAttribute('style');
        }
      });
    } else if (node.nodeType === Node.COMMENT_NODE) {
      node.parentNode?.removeChild(node);
      return;
    }
    // Walk children snapshot to avoid live mutation issues
    Array.from(node.childNodes).forEach(walk);
  };

  Array.from(tpl.content.childNodes).forEach(walk);
  return tpl.innerHTML;
}

export default sanitizeHtml;

