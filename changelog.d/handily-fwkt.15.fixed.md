- **handily-reply-view 0.5.2 names the reply on its copy button.** The button that copies a
  whole long reply now reads `copy reply`, so under a reply that ends with a code block it no
  longer looks like the `copy` button of that block. Each copy toast names the copied part and
  its line count, such as `Copied the sh block (2 lines).` or
  `Copied the reply as markdown (61 lines).`. On a narrow screen the count of hidden lines is
  cut at its end, so the buttons stay on its line (handily-fwkt.15).
