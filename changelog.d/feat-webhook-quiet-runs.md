### Changed

- A webhook run of an agent routine can now end silently, as a scheduled run can. When every answer of the run is exactly `[[no-update]]`, OpenBot keeps only the run marker and sends no notification. Before, each webhook delivery that needed no action notified you. Test runs and script runs still show their answer.
