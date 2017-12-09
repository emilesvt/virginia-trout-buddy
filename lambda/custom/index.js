"use strict";
const Alexa = require("alexa-sdk");
const cheerio = require("cheerio");
const moment = require("moment");
const rp = require("request-promise");
const ImageUtils = require("alexa-sdk").utils.ImageUtils;
const TextUtils = require("alexa-sdk").utils.TextUtils;

const MAX_RESULTS = 6;

const APP_ID = "amzn1.ask.skill.6da4434e-71dd-40c5-b557-0bd3dcdb8032";

exports.handler = function (event, context) {
    const alexa = Alexa.handler(event, context);
    alexa.APP_ID = APP_ID;
    alexa.registerHandlers(handlers);
    alexa.execute();
};

const handlers = {
    "LaunchRequest": function () {
        this.emit(":ask", "Welcome to Virginia Trout Buddy! Try asking for recent stockings or stockings on a specific day.");
    },
    "StockingsDefault": function () {
        console.log(`Received the following event for StockingsDefault: ${JSON.stringify(this.event.request)}`);
        retrieveStockings().then(stockings => {
            // check to ensure there was stocking data
            if (stockings.length === 0) {
                this.emit(":tell", `The <say-as interpret-as="characters">VDGIF</say-as> currently doesn't have any stocking information.`);
                return;
            }

            // get out last day of stocking information and present only information on that day
            const date = stockings[0].date;
            const filtered = stockings.filter(stocking => date.isSame(stocking.date));

            this.response.speak(`The last stocking${filtered.length > 1 ? "s were" : " was"} on ${ssmlDate(date)}.  ${filtered.length > 1 ? "They were" : "It was"} performed at ${aggregateStockingLocations(filtered)}.`);

            if (this.event.context.System.device.supportedInterfaces.Display) {
                this.response.renderTemplate(createStockingMapTemplate(filtered));
            }

            this.emit(':responseReady');
        }).catch(err => {
            console.error(err);
            this.emit("FetchError");
        });
    },
    "StockingsByDate": function () {
        console.log(`Received the following event for StockingsByDate: ${JSON.stringify(this.event.request)}`);

        try {
            const startDate = normalizeSlotDate(getSlotValue(this.event.request.intent.slots.StartDate));
            const endDate = normalizeSlotDate(getSlotValue(this.event.request.intent.slots.EndDate));

            if (startDate && endDate) {
                this.emit("StockingsByRange", startDate, endDate);
                return;
            } else if (this.event.request.intent.slots.StartDate.value &&
                this.event.request.intent.slots.StartDate.value.indexOf("W") !== -1) {
                this.emit("StockingsByRange", startDate, moment(startDate).days(startDate.days() + 6));
                return;
            }

            retrieveStockings(startDate).then(stockings => {
                // check to ensure there was stocking data
                if (stockings.length === 0) {
                    this.emit(":tell", `There were no stockings for ${ssmlDate(startDate)}`);
                    return;
                } else if (stockings.length > MAX_RESULTS) {
                    this.emit("TooManyResults");
                    return;
                }

                // TODO: check for too many results after filter
                this.response.speak(`On ${ssmlDate(startDate)}, there were ${stockings.length} stocking${stockings.length > 1 ? "s" : ""}.  ${stockings.length > 1 ? "They were" : "It was"} performed at ${aggregateStockingLocations(stockings)}.`);

                if (this.event.context.System.device.supportedInterfaces.Display) {
                    this.response.renderTemplate(createStockingMapTemplate(stockings));
                }

                this.emit(":responseReady");
            }).catch(err => {
                console.error(err);
                this.emit("FetchError");
            });
        } catch (e) {
            if (e.message === "InvalidDate") {
                this.emit("InvalidDateInput");
            } else {
                throw e;
            }
        }
    },
    "StockingsByRange": function (startDate, endDate) {

        if (startDate.isAfter(endDate)) {
            this.emit(":tell", `An invalid date range has been provided.  Please use a valid date range.`);
            return;
        }

        retrieveStockings(startDate, endDate).then(stockings => {
            // check to ensure there was stocking data
            if (stockings.length === 0) {
                this.emit(":tell", `There were no stockings between ${ssmlDate(startDate)} and ${ssmlDate(endDate)}`);
                return;
            } else if (stockings.length > MAX_RESULTS) {
                this.emit("TooManyResults");
                return;
            }

            // TODO: check for too many results after filter
            this.response.speak(`Between ${ssmlDate(startDate)} and ${ssmlDate(endDate)}, there were ${stockings.length} stocking${stockings.length > 1 ? "s" : ""}.  ${stockings.length > 1 ? "They were" : "It was"} performed at ${aggregateStockingAll(stockings)}.`);

            if (this.event.context.System.device.supportedInterfaces.Display) {
                this.response.renderTemplate(createStockingMapTemplate(stockings));
            }

            this.emit(":responseReady");
        }).catch(err => {
            console.error(err);
            this.emit("FetchError");
        });
    },
    "StockingsByCounty": function () {
        console.log(`Received the following event for StockingsByCounty: ${JSON.stringify(this.event.request)}`);

        const county = getSlotValue(this.event.request.intent.slots.County);

        retrieveStockings().then(stockings => {
            const filtered = stockings.filter(stocking => stocking.county.toLowerCase() === county.toLowerCase());

            // check to ensure there was stocking data
            if (filtered.length === 0) {
                this.emit(":tell", `No stocking information was found for ${county}`);
                return;
            }

            this.response.speak(`For ${county}, there ${filtered.length > 1 ? "were" : "was"} ${filtered.length} stocking${filtered.length > 1 ? "s" : ""}.  ${filtered.length > 1 ? "They were" : "It was"} performed on ${aggregateStockingDates(filtered)}.`);

            if (this.event.context.System.device.supportedInterfaces.Display) {
                this.response.renderTemplate(createStockingMapTemplate(filtered));
            }

            this.emit(":responseReady");
        }).catch(err => {
            console.error(err);
            this.emit("FetchError");
        });
    },
    "FetchError": function () {
        this.emit(":tell", `There was a problem communicating with the Virginia Department of Game and Inland Fisheries.`);
    },
    "TooManyResults": function () {
        this.emit(":tell", `There were too many stockings to discuss.  Trying narrowing your search`);
    },
    "InvalidDateInput": function () {
        this.emit(":tell", `A date provided was invalid. Please try your request again using a valid date like <say-as interpret-as="date" format="md">????1205}</say-as>`);
    },
    "SessionEndedRequest": function () {
        console.log("Session ended with reason: " + this.event.request.reason);
    },
    "AMAZON.StopIntent": function () {
        this.emit("AMAZON.CancelIntent");
    },
    "AMAZON.HelpIntent": function () {
        this.emit(":ask", "You can try asking for recent stockings or stockings on a specific day. What county would you like to fish in in the state of Virginia?");
    },
    "AMAZON.CancelIntent": function () {
        this.emit(":tell", "Bye");
    },
    "Unhandled": function () {
        this.emit(":tell", "Sorry, I didn't get that");
    }
};

function scrubDate(value) {
    return moment(Date.parse(value));
}

function scrubWater(value) {
    value = value.replace("&", "and");

    if (value && value.indexOf("(") > 0) {
        return value.substring(0, value.indexOf("("));
    }
    if (value && value.indexOf("[") > 0) {
        return value.substring(0, value.indexOf("["));
    }
    return value;
}

function retrieveStockings(startDate, endDate) {
    // https://www.dgif.virginia.gov/fishing/trout-stocking-schedule/?start_date=11%2F01%2F2017&end_date=12%2F07%2F2017
    let url = "https://www.dgif.virginia.gov/fishing/trout-stocking-schedule/";
    if (startDate) {
        url += `?start_date=${encodeURIComponent(startDate.format("MM/DD/YYYY"))}`;
    }

    endDate = endDate ? endDate : startDate;

    if (endDate) {
        url += `&end_date=${encodeURIComponent(endDate.format("MM/DD/YYYY"))}`;
    }

    console.log(`Using ${url} for the query`);
    return rp({
        method: "GET",
        uri: url,
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
            entries.push({
                date: scrubDate(tds[0]),
                county: tds[1].trim(),
                water: scrubWater(tds[2]).trim(),
                definition: tds[3].trim()
            });
        });
        console.log(`${entries.length} entries found for url ${url}`);
        return entries;
    });
}

function aggregateStockingAll(stockings) {
    return makeGoodListGrammar(stockings.map(stocking => `${stocking.water} in ${stocking.county} on ${ssmlDate(stocking.date)}`));
}

function aggregateStockingLocations(stockings) {
    return makeGoodListGrammar(stockings.map(stocking => `${stocking.water} in ${stocking.county}`));
}

function aggregateStockingDates(stockings) {
    return makeGoodListGrammar(stockings.map(stocking => `${ssmlDate(stocking.date)} at ${stocking.water}`));

}

function makeGoodListGrammar(descriptions) {
    if (descriptions.length === 1) {
        return descriptions[0];
    } else {
        return descriptions.map((description, index) => `${index === 0 ? "" : ", "}${index === descriptions.length - 1 ? "and " : ""}${description}`).join("");
    }
}

function normalizeSlotDate(value) {
    if (value) {
        let date = moment(value);

        if (date.isValid()) {
            if (date.isAfter(moment())) {
                date.year(date.year() - 1);
            }
        } else if (value.length === 4) {
            date = moment(`${value}-01-01`)
        } else {
            throw new Error("InvalidDate");
        }

        return date;
    }
}

function ssmlDate(date) {
    return `<say-as interpret-as="date" format="md">????${date.format("MMDD")}</say-as>`;
}

function createStockingMapTemplate(stockings) {
    const url = "https://maps.googleapis.com/maps/api/staticmap?&size=340x340&type=hybrid" + stockings.map((stocking, index) => `&markers=label:${index + 1}|${stocking.water},${stocking.county},VA`).join("");
    const builder = new Alexa.templateBuilders.BodyTemplate3Builder();
    const text = TextUtils.makeRichText(stockings.map((stocking, index) => `${index + 1}.&#160;&#160;${stocking.water.trim()}<br/>`).join(""));
    return builder.setBackButtonBehavior("HIDDEN").setTitle("Trout Stocking Map").setTextContent(text).setImage(ImageUtils.makeImage(url, undefined, undefined, undefined, "Trout Stocking Map with Markers for Locations"))
        .build();
}

function getSlotValue(slot) {
    if (slot.resolutions && slot.resolutions.resolutionsPerAuthority && slot.resolutions.resolutionsPerAuthority[0].status.code === "ER_SUCCESS_MATCH") {
        return slot.resolutions.resolutionsPerAuthority[0].values[0].value.name;
    }

    return slot.value;
}
