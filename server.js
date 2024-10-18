const express = require("express");
const mysql = require("mysql2");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// MySQL Connection Setup
const db = mysql.createConnection({
  host: "localhost",
  user: "root",
  password: "",
  database: "smartqueuedb",
});

db.connect((err) => {
  if (err) {
    console.error("Error connecting to database: " + err.stack);
    return;
  }
  console.log("Connected to database");
});

app.get("/", (req, res) => {
  res.json("hello world");
});

// Create a new user and save to the database
app.post("/users/signup", (req, res) => {
  const { uid, name, email, role } = req.body;

  const insertUserQuery = `
    INSERT INTO users (uid, name, email, role)
    VALUES (?, ?, ?, ?)
  `;

  db.query(insertUserQuery, [uid, name, email, role], (err, results) => {
    if (err) return res.status(500).send({ error: err.message });

    res.status(201).send({
      message: "User created and saved in database successfully!",
      userId: results.insertId,
    });
  });
});

// Get specific user by ID
app.get("/users/:userId", (req, res) => {
  const { userId } = req.params;
  const getUserQuery = `SELECT * FROM users WHERE id = ?`;

  db.query(getUserQuery, [userId], (err, results) => {
    if (err) return res.status(500).send({ error: err.message });

    if (results.length === 0) {
      return res.status(404).send({ message: "User not found" });
    }

    res.status(200).send(results[0]);
  });
});

app.get("/user-role/:uid", (req, res) => {
  const userId = req.params.uid;

  const checkUserRoleQuery = `SELECT role FROM users WHERE uid = ?`;

  db.query(checkUserRoleQuery, [userId], (err, results) => {
    if (err) return res.status(500).send(err);

    if (results.length === 0) {
      return res.status(404).send("User not found.");
    }

    const userRole = results[0].role;
    res.status(200).send({ role: userRole });
  });
});

// Create Queue API
app.post("/create-queue", (req, res) => {
  const { creatorId, queueName, queueDescription, maxCapacity } = req.body;

  // Check if all required fields are present
  if (!creatorId || !queueName || !queueDescription || !maxCapacity) {
    return res.status(400).send({ message: "All fields are required." });
  }

  // Check if the user has the "poster" role
  const checkUserRoleQuery = `SELECT role FROM users WHERE uid = ?`;
  db.query(checkUserRoleQuery, [creatorId], (err, roleResult) => {
    if (err) return res.status(500).send(err);

    // If user is not found or does not have the "poster" role
    if (roleResult.length === 0 || roleResult[0].role !== "creator") {
      return res
        .status(403)
        .send({ message: "Only 'poster' users can create queues." });
    }

    // Insert the new queue into the database
    const createQueueQuery = `
      INSERT INTO queues (creator_id, queue_name, queue_description, max_capacity)
      VALUES (?, ?, ?, ?)`;

    db.query(
      createQueueQuery,
      [creatorId, queueName, queueDescription, maxCapacity],
      (err, result) => {
        if (err) return res.status(500).send(err);

        res.status(200).send({
          message: "Queue created successfully!",
          queueId: result.insertId,
          queueName,
          queueDescription,
          maxCapacity,
        });
      }
    );
  });
});

/**
 * 3. Join Queue: Only 'enlister' users can join a queue.
 * Accepts: userId, queueId
 */
app.post("/join-queue", (req, res) => {
  const { userId, queueId } = req.body;

  // Check if userId and queueId are provided
  if (!userId || !queueId) {
    return res
      .status(400)
      .send({ message: "User ID and Queue ID are required." });
  }

  // Step 1: Check if the user has the role 'enlister'
  const checkUserRoleQuery = `SELECT role FROM users WHERE uid = ?`;
  db.query(checkUserRoleQuery, [userId], (err, results) => {
    if (err) return res.status(500).send({ error: err });

    if (results.length === 0) {
      return res.status(404).send({ message: "User not found." });
    }

    const userRole = results[0].role;
    if (userRole !== "enlister") {
      return res
        .status(403)
        .send({ message: "Only 'enlister' users can join a queue." });
    }

    // Step 2: Check if the user has already joined the queue
    const checkExistingQueueQuery = `SELECT * FROM queue_status WHERE user_id = ? AND queue_id = ?`;
    db.query(checkExistingQueueQuery, [userId, queueId], (err, existingResults) => {
      if (err) return res.status(500).send({ error: err });

      if (existingResults.length > 0) {
        return res.status(400).send({
          message: "You have already joined this queue.",
        });
      }

      // Step 3: Check the maximum capacity of the queue
      const checkQueueCapacityQuery = `SELECT COUNT(*) AS current_count, max_capacity FROM queues WHERE id = ?`;
      db.query(checkQueueCapacityQuery, [queueId], (err, queueResults) => {
        if (err) return res.status(500).send({ error: err });

        const currentCount = queueResults[0].current_count;
        const maxCapacity = queueResults[0].max_capacity;

        if (currentCount >= maxCapacity) {
          return res
            .status(400)
            .send({ message: "The queue has reached its maximum capacity." });
        }

        // Step 4: Calculate the next queue number for the user
        const getMaxQueueNumberQuery = `SELECT IFNULL(MAX(queue_number), 0) + 1 AS next_queue_number FROM queue_status WHERE queue_id = ?`;

        db.query(getMaxQueueNumberQuery, [queueId], (err, maxQueueNumberResult) => {
          if (err) return res.status(500).send({ error: err });

          const nextQueueNumber = maxQueueNumberResult[0].next_queue_number;

          // Step 5: Insert the user into the queue with the calculated queue number
          const insertQueueQuery = `
            INSERT INTO queue_status (user_id, queue_id, status, queue_number, join_time)
            VALUES (?, ?, 'waiting', ?, NOW())`;

          db.query(insertQueueQuery, [userId, queueId, nextQueueNumber], (err, queueResult) => {
            if (err) return res.status(500).send({ error: err });

            res.status(200).send({
              message: "Successfully joined the queue!",
              queueId,
              userId,
              position: nextQueueNumber, // Return the assigned queue number
            });
          });
        });
      });
    });
  });
});


app.get("/queues/:userId", (req, res) => {
  const { userId } = req.params;

  // Query to select all queues created by the given user ID
  const getQueuesByUserQuery = `
    SELECT id, queue_name, queue_description, max_capacity, created_at 
    FROM queues 
    WHERE creator_id = ?`;

  db.query(getQueuesByUserQuery, [userId], (err, results) => {
    if (err) {
      return res
        .status(500)
        .send({ error: "Failed to retrieve queues. Please try again." });
    }

    // If no queues are found, send an empty array
    if (results.length === 0) {
      return res.status(200).send({
        message: "No queues found for the specified user.",
        queues: [],
      });
    }

    res.status(200).send({
      message: "Successfully retrieved all queues created by the user.",
      queues: results,
    });
  });
});

/**
 * 4. Update Queue Status: Admin can update the queue status for a user.
 * Accepts: userId, queueId, newStatus
 */
app.put("/update-queue-status", (req, res) => {
  const { userId, queueId, newStatus } = req.body;
  console.log(newStatus);
  const updateStatusQuery = `UPDATE queue_status SET status = ? WHERE user_id = ? AND queue_id = ?`;
  db.query(updateStatusQuery, [newStatus, userId, queueId], (err, result) => {
    if (err) return res.status(500).send(err);

    res.status(200).send({
      message: "Queue status updated successfully!",
      userId,
      queueId,
      newStatus,
    });
  });
});

app.get("/all-queue-users/:queueId", (req, res) => {
  const { queueId } = req.params;

  const getAllQueueUsersQuery = `
    SELECT u.name, qs.queue_number, qs.status, qs.user_id
    FROM queue_status qs
    JOIN users u ON qs.user_id = u.uid
    WHERE qs.queue_id = ?
    ORDER BY qs.queue_number ASC`;

  db.query(getAllQueueUsersQuery, [queueId], (err, result) => {
    if (err) return res.status(500).send({ message: "Database error" });

    res.status(200).send(result);
  });
});


// user served in queue api

app.post("/serve-user/:userId/:queueId", (req, res) => {
  const { userId, queueId } = req.params;

  // Step 1: Get the queue number of the user who is being served
  const getQueueNumberQuery = `SELECT queue_number FROM queue_status WHERE user_id = ? AND queue_id = ?`;
  db.query(getQueueNumberQuery, [userId, queueId], (err, result) => {
    if (err) return res.status(500).send({ message: "Database error" });

    if (result.length === 0) {
      return res.status(404).send({ message: "User not found in queue" });
    }

    const servedQueueNumber = result[0].queue_number;

    // Step 2: Mark the user as "served"
    const markAsServedQuery = `UPDATE queue_status SET status = 'served' WHERE user_id = ? AND queue_id = ?`;
    db.query(markAsServedQuery, [userId, queueId], (err) => {
      if (err) return res.status(500).send({ message: "Failed to update user status" });

      // Step 3: Shift the queue numbers of users behind the served user
      const shiftQueueNumbersQuery = `
        UPDATE queue_status 
        SET queue_number = queue_number - 1 
        WHERE queue_id = ? AND queue_number > ?`;

      db.query(shiftQueueNumbersQuery, [queueId, servedQueueNumber], (err) => {
        if (err) return res.status(500).send({ message: "Failed to shift queue numbers" });

        res.status(200).send({ message: "User marked as served, queue numbers updated" });
      });
    });
  });
});


/**
 * 5. View Queue Status: User can view their position and status in the queue.
 * Accepts: userId, queueId
 */
app.get("/queue-status/:userId/:queueId", (req, res) => {
  const { userId, queueId } = req.params;

  const getQueueStatusQuery = `
  SELECT qs.queue_number, qs.status, q.queue_name
  FROM queue_status qs
  JOIN queues q ON qs.queue_id = q.id
  WHERE qs.user_id = ? AND qs.queue_id = ?`;

  db.query(getQueueStatusQuery, [userId, queueId], (err, results) => {
    if (err) return res.status(500).send(err);

    if (results.length === 0) {
      return res.status(404).send("Queue status not found.");
    }

    res.status(200).send(results[0]);
  });
});



app.get("/joined-queues/:userId", (req, res) => {
  const { userId } = req.params;

  // SQL query to get all queues the user has joined
  const getUserJoinedQueuesQuery = `
    SELECT qs.queue_id, qs.queue_number, qs.status, q.queue_name, q.queue_description
    FROM queue_status qs
    JOIN queues q ON qs.queue_id = q.id
    WHERE qs.user_id = ?`;

  db.query(getUserJoinedQueuesQuery, [userId], (err, results) => {
    if (err) {
      return res.status(500).send({ error: err });
    }

    if (results.length === 0) {
      return res.status(404).send({ message: "No queues found for this user." });
    }

    res.status(200).send({
      message: "Queues the user has joined:",
      joinedQueues: results
    });
  });
});


app.get('/api/queues', (req, res) => {
  // Query to select all queues from the 'queues' table
  const getAllQueuesQuery = `
    SELECT id, queue_name, queue_description, max_capacity 
    FROM queues
  `;

  db.query(getAllQueuesQuery, (err, results) => {
    if (err) {
      return res.status(500).json({ message: 'Database error', error: err });
    }

    if (results.length === 0) {
      return res.status(404).json({ message: 'No queues found' });
    }

    // Return the list of queues
    res.status(200).json(results);
  });
});



/**
 * 6. View All Customers in Queue: Admin can see the list of all customers currently waiting in a queue.
 * Accepts: queueId
 */
// app.get("/all-customers/:queueId", (req, res) => {
//   const { queueId } = req.params;

//   const getAllCustomersQuery = `
//     SELECT u.name, u.email, u.phone, qs.queue_number, qs.status
//     FROM queue_status qs
//     JOIN users u ON qs.user_id = u.id
//     WHERE qs.queue_id = ? AND qs.status = 'waiting'
//     ORDER BY qs.queue_number`;

//   db.query(getAllCustomersQuery, [queueId], (err, results) => {
//     if (err) return res.status(500).send(err);

//     res.status(200).send(results);
//   });
// });

app.get("/view-queue/:queueId", (req, res) => {
  const { queueId } = req.params;

  const viewQueueQuery = `
    SELECT qs.queue_number, qs.user_id, qs.status, u.name 
    FROM queue_status qs
    INNER JOIN users u ON qs.user_id = u.uid
    WHERE qs.queue_id = ?
    ORDER BY qs.queue_number ASC`;

  db.query(viewQueueQuery, [queueId], (err, results) => {
    if (err) return res.status(500).send({ error: err });

    res.status(200).send({
      message: "Successfully fetched all customers in the queue.",
      customers: results,
    });
  });
});

// In your server.js or routes file
app.get("/api/queues/search", (req, res) => {
  const { query } = req.query; // Assume a query parameter for searching
  const searchQuery = `
    SELECT * FROM queues
    WHERE queue_name LIKE ? OR queue_description LIKE ?
  `;

  db.query(searchQuery, [`%${query}%`, `%${query}%`], (err, results) => {
    if (err) return res.status(500).send(err);
    res.status(200).json(results);
  });
});

// Endpoint to get user details by userId
app.get('/api/users/:userId', (req, res) => {
  const { userId } = req.params;

  // SQL query to fetch user details (including name) by user ID
  const getUserDetailsQuery = 'SELECT uid, name, email, role FROM users WHERE uid = ?';

  db.query(getUserDetailsQuery, [userId], (err, results) => {
    if (err) {
      return res.status(500).send({ message: 'Database error', error: err });
    }

    if (results.length === 0) {
      return res.status(404).send({ message: 'User not found' });
    }

    // Send user details as response
    res.status(200).send({
      uid: results[0].uid,
      name: results[0].name,
      email: results[0].email,
      role: results[0].role
    });
  });
});



// Queue status for enlister
app.get("/api/queue-status/:userId/:queueId", (req, res) => {
  const { userId, queueId } = req.params;

  const queueStatusQuery = `
    SELECT qs.queue_number, 
           (SELECT COUNT(*) FROM queue_status WHERE queue_id = ?) AS total_people
    FROM queue_status qs
    WHERE qs.user_id = ? AND qs.queue_id = ?
  `;

  db.query(queueStatusQuery, [queueId, userId, queueId], (err, results) => {
    if (err) return res.status(500).send(err);
    
    if (results.length === 0) {
      return res.status(404).send("Queue status not found.");
    }

    res.status(200).json(results[0]); // Return the first result
  });
});



// Start Server
app.listen(5000, () => {
  console.log("Server running on port 5000");
});
