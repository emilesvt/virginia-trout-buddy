const joda = require("js-joda");
const value = Date.parse("December 5, 2007");
console.log(joda.LocalDateTime.ofInstant(joda.Instant.ofEpochMilli(value)).toLocalDate().toString());