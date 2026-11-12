- **reply-view can draw each reply in a frame labelled `● Claude`.** The new `replyStyle`
  setting is `off` by default. With `frame`, each text block of a reply draws in a frame, and the
  first carries `● Claude`. Tables, code blocks and diagrams draw inside it. The frame takes 4
  columns where the bullet takes 2, so a line holds 76 columns at 80 and 36 at 40. Under 40
  columns no frame draws, and the desktop app draws no frame. A mouse selection takes the frame
  characters, but `copy reply`, the `copy` buttons and `/replies copy` copy no frame character
  (handily-36bsx.8).
