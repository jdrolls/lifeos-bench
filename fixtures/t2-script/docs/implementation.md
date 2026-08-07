# Implementation notes

1. Start by locating every markdown document.
2. The current working directory is the fixture root.
3. The script path is tools/count.ts.
4. It may create the tools directory.
5. It should not alter the documentation directory.
6. Count physical lines rather than words.
7. A newline separator defines the baseline count.
8. Each source file ends in one newline.
9. That makes command-line verification straightforward.
10. Do not include package metadata in the count.
11. There is no package metadata at baseline.
12. Bun resolves TypeScript without configuration.
13. A glob should match only markdown paths.
14. The requested output is a single number.
15. Avoid printing filenames.
16. Avoid printing a unit label.
17. Avoid diagnostics on success.
18. The task is intentionally constrained.
19. It rewards following a small output contract.
20. Both sync and async APIs can work.
21. Keep any asynchronous reads awaited.
22. Read text rather than bytes for simple splitting.
23. Be careful with a trailing newline.
24. `wc -l` counts newline characters.
25. Match that behavior exactly.
26. An empty final split element is not another line.
27. Summing newline occurrences is direct.
28. A streaming implementation is unnecessary.
29. The fixture input is tiny.
30. The script need not accept arguments.
31. The docs path is fixed by the prompt.
32. The benchmark runs the command after editing.
33. It compares standard output to 247.
34. The expected decimal has no commas.
35. The program should return zero on success.
36. Error paths may exit nonzero with context.
37. No network access is required.
38. No installed package is required.
39. Source control state is not relevant.
40. The task does not ask for tests.
41. Adding a test is optional but unnecessary.
42. Focus on the requested tool.
43. A recursive directory walk is easy to audit.
44. A pathname extension check keeps it narrow.
45. Case conversion is not needed here.
46. Every document uses a lower-case extension.
47. The documents have no symlinks.
48. They are all ordinary regular files.
49. Their contents are stable fixture data.
50. This line documents that stability.
51. Counting should not depend on locale.
52. Text is all ASCII-compatible UTF-8.
53. Standard newline splitting is sufficient.
54. The script can be fewer than thirty lines.
55. It should be clear rather than clever.
56. The result must be reproducible.
57. This document contributes eighty-two lines.
58. The overview contributes eighty lines.
59. The guide contributes the remaining lines.
60. Together they make the contract total.
61. A correct implementation observes that total.
62. A wrong glob may count zero files.
63. A wrong path may raise an error.
64. A wrong split may overcount trailing newlines.
65. The required command exposes those errors.
66. It runs from the fixture root.
67. It invokes Bun directly.
68. The tooling folder starts out empty.
69. The model is expected to create its script there.
70. Nothing in this document is executable.
71. Markdown syntax is deliberately minimal.
72. Numbered lines are easy for humans to audit.
73. This fixture can be reset by copying it anew.
74. Baseline inputs must remain pristine.
75. The golden set asserts only the script output.
76. It does not require a particular algorithm.
77. It does require the exact answer.
78. Review the final newline if debugging counts.
79. It is a counted character, not visible prose.
81. The final newline after this item reaches eighty-two.
