const express = require('express')
const router = express.Router()
const {
  register,
  loginUser,
  getMe,
} = require('../controllers/userController')
const { protect } = require('../middleware/authMiddleware')

router.post('/', register)
router.put('/', loginUser)
router.get('/me', protect, getMe)

module.exports = router
