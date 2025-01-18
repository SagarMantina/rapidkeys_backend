const express = require("express");
const http = require("http");
const cors = require("cors");
const path = require("path");
const dotenv = require("dotenv");
const cookieParser = require("cookie-parser");
const mongoose = require("mongoose");
const { Server } = require("ws");

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;




// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use(cookieParser());
app.use(
  cors({
    origin: "https://rapid-keys-4fglw2ho4-mantina-sagars-projects.vercel.app",
    credentials: true,
  })
);

// MongoDB Connection
const connect = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
    });
    console.log("Connected to MongoDB");
  } catch (error) {
    console.error("Error connecting to MongoDB:", error);
  }
};

connect();

// Match Schema and Model
const matchSchema = new mongoose.Schema({
  name: String,
  players: [String],
  winner: { type: String, default: null },
  timestamp: { type: Date, default: Date.now },
});


const userSchema = new mongoose.Schema({
  name: String,
  password: String,
  score : [Number],
})


const User = mongoose.model("User", userSchema);
const Match = mongoose.model("Match", matchSchema);

// WebSocket Server


app.get("/stats", async (req,res) =>{
  try{
     const user = req.cookies.username;
     const userStats = await User.findOne({name:user});

     stats= userStats.score;
     console.log(stats);

     res.status(200).json(stats);
  }catch(error){
    console.log(error);
  }
})
app.post("/signup", async (req, res) => {
  const { name, password } = req.body;


  const existingUser = await User.findOne({ name });
  if (existingUser) {
    return res.json({ success: false, message: "User already exists" });
  }


  const newUser = new User({ name, password });

  console.log(newUser);
  await newUser.save();

  res.status(200).json({ success: true });
});


app.post("/logout", async (req, res)=>{
   try{

     res.clearCookie("username");
     res.status(200).json({message : "Successfully Logged Out"});
   }

   catch (err) {
    console.log(err);
    res.status(500).json({ message: "Logout Failed" });
}
})
app.post("/login", async (req, res) => {
  const { name, password } = req.body;
  const user = await User.findOne({ name, password });
  if (user) {
    res.cookie("username", name, {
      httpOnly: false,    // Make cookie accessible to frontend
      secure: process.env.NODE_ENV === "production", // Set true in production
      sameSite: "Lax",    // SameSite policy to prevent CSRF
    });
    res.status(200).json({ success: true });
  } else {
    res.json({ success: false });
  }
});

const server = http.createServer(app);
const wss = new Server({ server });
let matches = {};

wss.on("connection", (ws) => {
  console.log("Player connected");

  ws.on("message", async (message) => {
    const data = JSON.parse(message);
 
    if (data.type === "room_join") {
      const { playerName, roomId } = data;
      const roomName = `Match-${roomId}`;
      let match = await Match.findOne({ name: roomName });

      if (!match) {
        match = new Match({ name: roomName, players: [playerName] });
        console.log("match saved in message 111", match);
        await match.save();
        matches[roomName] = [];
      } else if (match.players.length < 3) {
        match.players.push(playerName);
        console.log("match saved in message 116", match);
        await match.save();
      } else {
        ws.send(JSON.stringify({ type: "error", message: "Room is full" }));
        return;
      }

      matches[roomName].push(ws);

      // Notify players in the room
      matches[roomName].forEach((playerWs) => {
        playerWs.send(
          JSON.stringify({
            type: "update",
            match: match.name,
            players: match.players,
          })
        );
      });
    }
    if (data.type === "join") {
      const { playerName } = data;
      
      let match = await Match.findOne({
        $and: [
          { "players.0": { $exists: true } }, 
          { "players.2": { $exists: false } } 
        ],
        winner: null
      });
      
      if (!match) {
        match = new Match({ name: `Match-${Date.now()}`, players: [playerName] });
        console.log("match saved in message 149", match);
        await match.save();
      } else {
        match.players.push(playerName);
        console.log("match saved in message 153", match);
        await match.save();
      }

      if (!matches[match.name]) {
        matches[match.name] = [];
      }
      matches[match.name].push(ws);

      matches[match.name].forEach((playerWs) => {
        playerWs.send(
          JSON.stringify({
            type: "update",
            match: match.name,
            players: match.players,
          })
        );
      });
    }

    if (data.type === "progress") {
      const { matchName, playerName, progress,wpm } = data;

      if (matches[matchName]) {
        matches[matchName].forEach((playerWs) => {
          playerWs.send(
            JSON.stringify({
              type: "progress",
              playerName,
              progress,
              wpm
            })
          );
        });
      }
    }

    if (data.type === "winner") {
      const { matchName, winner } = data;
      const match = await Match.findOne({ name: matchName });
      if (match) {
        match.winner = winner;
        console.log("match saved in message 195", match);
        await match.save();
      }
    
  
      if (matches[matchName]) {
        matches[matchName].forEach((playerWs) => {
          playerWs.send(
            JSON.stringify({
              type: "winner",
              winner,
            })
          );
        });
      }
    }
  });

  ws.on("close", async () => {
    console.log("Player disconnected");
  
   
    for (const matchName in matches) {
      const players = matches[matchName];
  
    
      const playerIndex = players.indexOf(ws);
      if (playerIndex !== -1) {
       
        players.splice(playerIndex, 1);
  
    
        const match = await Match.findOne({ name: matchName });
        if (match) {
          const disconnectedPlayer = match.players[playerIndex];
          match.players = match.players.filter((_, index) => index !== playerIndex);
  
          if (match.players.length === 1 && match.winner === null) {

            console.log("check 234");
            // End the match and declare the remaining player as the winner
            match.winner = match.players[0];
            console.log("Match ended due others disconnection Winner:", match.winner);

            console.log("match saved in 237", match);
            await match.save();
  
            // Notify the remaining player
            matches[matchName][0]?.send(
              JSON.stringify({
                type: "winner",
                winner: match.winner,
              })
            );
  
            // Clean up the match
            delete matches[matchName];

          } else {
            // Update remaining players
            // await match.save();
  
            players.forEach((playerWs) => {
              playerWs.send(
                JSON.stringify({
                  type: "update",
                  match: matchName,
                  players: match.players,
                })
              );
            });
          }
        }
        break;
      }
    }
  });
  
});


app.post("/save_score", async (req, res) => {
  const {  score } = req.body;
  const temp_user = req.cookies.username;
  const user = await User.findOne({ name: temp_user });
  console.log(score);
  if (user) {
    user.score.push(score);
    await user.save();
   
    res.status(200).json({ success: true, message: "Score updated" });
  } else {
    res.status(404).json({ success: false, message: "User not found" });
  }
});


app.post("/auth_verify", async (req, res) => {
  try {
    const user_logged = req.cookies.username;

    if (!user_logged) {
      return res.status(404).json({ error: "Please Login first to play the game" });
    }

    const user_exists = await User.findOne({ name: user_logged });

    if (!user_exists) {
      return res.status(404).json({ error: "Please Try to Login first and then play the game" });
    }

    return res.status(200).json({ success: "User Logged In" });
  } catch (err) {
    console.error("Error in /auth_verify:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});


app.delete("/api/match/:name", async (req, res) => {
  const { name } = req.params;
  const match = await Match.findOne({ name });
  if (match) {
    await Match.deleteOne({ name });
    delete matches[name];
    res.json({ success: true, message: "Match deleted" });
  } else {
    res.status(404).json({ success: false, message: "Match not found" });
  }
});

app.post("/api/check_room", async (req,res)=>{
    const roomId= req.body;
    const roomName= "Match-"+ stringify(roomId);
    let match = await Match.findOne({
        name : roomName
    })

    if(match)
    {
      res.status(200).json({message :"Room Found , joining"});
    }
    res.status(404).json({ success: false, message: "Match not found" });
})

app.get("/api/leaderboard", async (req, res) => {
  try {
   
    const users = await User.find();


    const usersWithMaxScores = users.map(user => ({
      name: user.name,
      maxScore: Math.max(...user.score) 
    }));

 
    const sortedUsers = usersWithMaxScores.sort((a, b) => b.maxScore - a.maxScore);

    
    const topUsers = sortedUsers.slice(0, 10);

    res.status(200).json(topUsers);
  } catch (error) {
    console.error("Error fetching leaderboard:", error);
    res.status(500).json({ message: "An error occurred." });
  }
});

// Start Server
server.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
