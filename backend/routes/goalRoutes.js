const express = require('express')
const router = express.Router()
const {
  getGoals,
  setGoal,
  updateGoal,
  delete,
} = require('../controllers/goalController')

const { protect } = require('../middleware/authMiddleware')

router.route('/').post(getGoals).post(protect, setGoal)
router.route('/;id').put(protect, delete).put(protect, updateGoal)

module.exports = router
