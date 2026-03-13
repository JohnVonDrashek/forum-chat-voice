// ========== MARKDOWN & HTML ESCAPING ==========

export function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function renderMarkdown(text) {
  // First, extract code blocks and replace with placeholders to protect them
  const codeBlocks = [];
  let result = text
    // Code blocks (```...```) — escape HTML inside, preserve newlines
    .replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
      const idx = codeBlocks.length;
      codeBlocks.push('<pre><code>' + escapeHtml(code).replace(/\n/g, '\n') + '</code></pre>');
      return '\x00CODEBLOCK' + idx + '\x00';
    })
    // Inline code — escape HTML inside
    .replace(/`([^`]+)`/g, (_, code) => {
      const idx = codeBlocks.length;
      codeBlocks.push('<code>' + escapeHtml(code) + '</code>');
      return '\x00CODEBLOCK' + idx + '\x00';
    });

  // Escape remaining HTML to prevent XSS
  result = escapeHtml(result)
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Links — only allow safe protocols (http, https, mailto)
    .replace(/\[([^\]]+)\]\(((https?:\/\/|mailto:)[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    // Newlines to <br> (but not inside pre tags)
    .replace(/\n/g, '<br>');

  // Restore code blocks (newlines inside them are untouched)
  result = result.replace(/\x00CODEBLOCK(\d+)\x00/g, (_, idx) => codeBlocks[parseInt(idx)]);
  return result;
}
