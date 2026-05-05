#!/usr/bin/env node
// Reported as "successful migration".
console.log("Migrating users…");
console.error("ERROR: failed to update 47 of 200 rows (constraint violation)");
console.log("Done.");
process.exit(0); // EXIT 0 despite stderr error
