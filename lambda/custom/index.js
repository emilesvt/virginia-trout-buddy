"use strict";
const Alexa = require("alexa-sdk");
const cheerio = require("cheerio");
const joda = require("js-joda");
const rp = require("request-promise");

exports.handler = function (event, context) {
    const alexa = Alexa.handler(event, context);
    alexa.registerHandlers(handlers);
    alexa.execute();
};

const handlers = {
    "LaunchRequest": function () {
        this.response.speak("Welcome to Virginia Trout Buddy!");
        this.emit(":responseReady");
    },
    "ListStockings": function () {
        const startDateSlot = this.event.request.intent.slots.StartDate.value;
        const endDateSlot = this.event.request.intent.slots.EndDate.value;

        if (startDateSlot && !endDateSlot) {
            this.emit("ListStockingsWithSingleDate", normalizeSlotDate(startDateSlot));
        } else if (startDateSlot && endDateSlot) {
            this.emit("ListStockingsWithDateRange", normalizeSlotDate(startDateSlot), normalizeSlotDate(endDateSlot));
        } else {
            this.emit("ListStockingsDefault");
        }
    },
    "ListStockingsDefault": function () {
        retrieveStockings().then(stockings => {
            // check to ensure there was stocking data
            if (stockings.length === 0) {
                this.emit(":tell", `The <say-as interpret-as="characters">VDGIF</say-as> currently doesn't have any stocking information.`);
                return;
            }

            // get out last day of stocking information and present only information on that day
            const date = stockings[0].date;
            const filtered = stockings.filter(stocking => date.equals(stocking.date));
            this.emit(":tell", `The last stocking${filtered.length > 1 ? "s were" : " was"} on ${ssmlDate(date)}.  ${filtered.length > 1 ? "They were" : "It was"} performed at ${aggregateStockingLocations(filtered)}.`);
        }).catch(err => {
            console.error(err);
            this.emit("FetchError");
        });
    },
    "ListStockingsWithSingleDate": function (startDate) {
        retrieveStockings().then(stockings => {
            const filtered = stockings.filter(stocking => stocking.date.equals(startDate));

            // check to ensure there was stocking data
            if (filtered.length === 0) {
                this.emit(":tell", `There were no stockings for ${ssmlDate(startDate)}`);
                return;
            }

            this.emit(":tell", `On ${ssmlDate(startDate)}, there were ${filtered.length} stocking${filtered.length > 1 ? "s" : ""}.  ${filtered.length > 1 ? "They were" : "It was"} performed at ${aggregateStockingLocations(filtered)}.`);
        }).catch(err => {
            console.error(err);
            this.emit("FetchError");
        });
    },
    "FetchError": function () {
        this.emit(":tell", `There was a problem communicating with the <say-as interpret-as="characters">VDGIF</say-as>.`);
    },
    "SessionEndedRequest": function () {
        console.log("Session ended with reason: " + this.event.request.reason);
    },
    "AMAZON.StopIntent": function () {
        this.emit("AMAZON.CancelIntent");
    },
    "AMAZON.HelpIntent": function () {
        this.emit(":tell", "You can try asking for recent stockings or stockings on a specific day.");
    },
    "AMAZON.CancelIntent": function () {
        this.emit(":tell", "Bye");
    },
    "Unhandled": function () {
        this.emit(":tell", "Sorry, I didn't get that");
    }
};

function scrubDate(value) {
    return joda.LocalDateTime.ofInstant(joda.Instant.ofEpochMilli(Date.parse(value))).toLocalDate();
}

function scrubWater(value) {
    if (value && value.indexOf("(") > 0) {
        return value.substring(0, value.indexOf("("));
    }
    if (value && value.indexOf("[") > 0) {
        return value.substring(0, value.indexOf("["));
    }
    return value;
}

function retrieveStockings() {
    return rp({
        method: "GET",
        uri: "https://www.dgif.virginia.gov/fishing/trout-stocking-schedule",
        headers: {
            "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_12_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/62.0.3202.94 Safari/537.36"
        },
        transform: (body) => {
            return cheerio.load(body);
        }
    }).then($ => {
        const entries = [];
        $("#stocking-table").find("tbody").find("tr").each((i, elem) => {
            const tds = $(elem).find("td").map((i, td) => $(td).text());
            entries.push({date: scrubDate(tds[0]), county: tds[1], water: scrubWater(tds[2]), definition: tds[3]});
        });
        return entries;
    });
}

function aggregateStockingLocations(locations) {
    const descriptions = locations.map(location => `${location.water.trim()} in ${location.county.trim()}`);
    if (locations.length === 1) {
        return decriptions[0];
    } else {
        return descriptions.map((description, index) => `${index === 0 ? "" : ", "}${index === descriptions.length - 1 ? "and " : ""}${description}`).join("");
    }
}

function normalizeSlotDate(value) {
    const date = joda.LocalDate.parse(value);
    if (date.isAfter(joda.LocalDate.now())) {
        return date.minusYears(1);
    }
    return date;
}

function ssmlDate(date) {
    return `<say-as interpret-as="date" format="md">????${joda.DateTimeFormatter.ofPattern("MMdd").format(date)}</say-as>`;
}
