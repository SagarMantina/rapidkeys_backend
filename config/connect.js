const mongoose = require("mongoose");

async function connect(url) {
    try {
        await mongoose.connect(url);
       
    } catch (error) {
        console.error("Error connecting to MongoDB:", error);
    }
}

module.exports = {connect};