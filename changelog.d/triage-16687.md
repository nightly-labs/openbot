### Fixed

- An OpenCode routine or chat turn that ends with an `<execute>` block written as text, and not run, now shows "Failed" with the reason "The OpenCode model wrote its actions as text and did not do them. Try again, or choose another model." Before, the run showed "Succeeded" although no tool ran.
