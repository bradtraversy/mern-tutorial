import { useEffect, useState } from 'react'
import { useDispatch } from 'react-redux'
import { deleteGoal, updateGoal } from '../features/goals/goalSlice'

function GoalItem({ goal }) {
  const dispatch = useDispatch()
  const [isEditing, setIsEditing] = useState(false)
  const [text, setText] = useState(goal.text)

  useEffect(() => {
    setText(goal.text)
  }, [goal.text])

  const openEditPopup = () => {
    setText(goal.text)
    setIsEditing(true)
  }

  const closeEditPopup = () => {
    setIsEditing(false)
  }

  const onUpdate = async (e) => {
    e.preventDefault()

    await dispatch(
      updateGoal({
        id: goal._id,
        goalData: { text },
      })
    )

    closeEditPopup()
  }

  return (
    <>
      <div className='goal'>
        <div>{new Date(goal.createdAt).toLocaleString('en-US')}</div>
        <h2>{goal.text}</h2>
        <div className='goal-actions'>
          <button onClick={openEditPopup} className='edit'>
            Edit
          </button>
          <button
            onClick={() => dispatch(deleteGoal(goal._id))}
            className='close'
          >
            X
          </button>
        </div>
      </div>

      {isEditing && (
        <div className='modal-backdrop' onClick={closeEditPopup}>
          <div className='modal' onClick={(e) => e.stopPropagation()}>
            <div className='modal-header'>
              <h3>Update Goal</h3>
              <button className='modal-close' onClick={closeEditPopup}>
                ×
              </button>
            </div>

            <form onSubmit={onUpdate}>
              <div className='form-group'>
                <label htmlFor={`goal-${goal._id}`}>Goal</label>
                <input
                  type='text'
                  name='text'
                  id={`goal-${goal._id}`}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
              </div>

              <div className='modal-actions'>
                <button type='button' className='btn btn-reverse' onClick={closeEditPopup}>
                  Cancel
                </button>
                <button type='submit' className='btn'>
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}

export default GoalItem
