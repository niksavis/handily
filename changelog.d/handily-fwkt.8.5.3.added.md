- **handily-workitems 0.6.0 pauses and resumes every tracker read with `/workitems pause` and
  `/workitems resume`.** A pause stops the poll and every tracker read, and the snapshot state
  becomes `paused`. A refresh that another mod asks for then reads nothing and answers with the
  state `paused`. A resume polls again and reads the tracker once. A bare `/workitems` says if
  the reads run or are paused, and an unknown argument gets a reply that names the valid forms.
  quiet-items draws tracker commands in full, item-toasts shows no toast, and handily-board
  0.3.1 shows a dim paused line in place of the items. None of them shows an error for the
  pause (handily-fwkt.8.5.3).
