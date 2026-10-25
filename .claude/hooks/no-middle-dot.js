// PreToolUse(Write|Edit): blocks text containing a middle dot; this blog never uses one.
// Exit 2 rejects the tool call and hands stderr back to Claude.
const DOTS = /[·ㆍ・‧∙]/;

let raw = '';
process.stdin.on('data', (d) => { raw += d; });
process.stdin.on('end', () => {
  const t = JSON.parse(raw || '{}').tool_input || {};
  const text = [t.content, t.new_string, ...(t.edits || []).map((e) => e.new_string)].filter(Boolean).join('\n');
  const hit = text.match(DOTS);
  if (!hit) return;
  const line = text.split('\n').find((l) => DOTS.test(l)).trim();
  process.stderr.write(`가운뎃점(${hit[0]})은 이 블로그에서 쓰지 않는다. 쉼표, '와/과', 줄바꿈 등으로 바꿔 다시 써라.\n문제 줄: ${line}\n파일: ${t.file_path}\n`);
  process.exit(2);
});
