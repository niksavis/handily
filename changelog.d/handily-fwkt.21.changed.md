- **Breaking change: the marketplace is now named `niksavis`, so the install id is
  `handily@niksavis`.** `/plugin marketplace add niksavis/handily` still works and now adds the
  marketplace `niksavis`. To move from the old marketplace `handily`, run
  `claude plugin marketplace remove handily`, which also uninstalls each plugin you installed
  from it, then `claude plugin marketplace add niksavis/handily` and
  `claude plugin install handily@niksavis`, and type `/reload-plugins`. handily 0.6.0 `/handily`
  names each plugin still installed from the marketplace `handily` as an old id, with the line
  that uninstalls it and the line that removes the marketplace (handily-fwkt.21).
