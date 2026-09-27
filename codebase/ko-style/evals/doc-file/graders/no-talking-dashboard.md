---
type: regex
target: { source: file, path: guide.md }
match: not_contains
pattern: '(대시보드|화면|서버)(이|가|은|는)\s[^.\n]{0,24}말(합니다|한다|해\s?줍니다|해\s?준다)'
---
