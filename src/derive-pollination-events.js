
import _ from 'https://cdn.jsdelivr.net/npm/lodash-es@4.17.21/lodash.min.js'

const getFirstName = record => record?.first_name ?? record?.firstName
const getLastName = record => record?.last_name ?? record?.lastName
const getFullName = record => `${getFirstName(record)} ${getLastName(record)}`

export const addFullNames = ({ task, taskPayload }) => taskPayload?.map(userWithFriends => ({
  ...userWithFriends,
  full_name: getFullName(userWithFriends),
  usersFriends: {
    ...userWithFriends?.usersFriends,
    friends: task?.value?.withFriends ? userWithFriends?.usersFriends?.friends?.map(friend => ({
      ...friend,
      fullName: getFullName(friend),
    })) : userWithFriends?.usersFriends?.friends,
  },
}))

export const derivePollinationEvents = ({ taskPayload, assemblyState }) => {
  const editedRecords = taskPayload?.modified ?? []
  const currentPollinationEvents = assemblyState.payloads['f8a49cee-c614-437e-8242-5435b62029b0']

  const pollinationEvents = []
  const attempts = []

  // eslint-disable-next-line no-unused-expressions
  editedRecords?.forEach(record => {
    const pollinationEvent = {}
    const pollinationIntentId = record.id
    const femaleEntryId = record.femaleEntryId
    const maleEntryId = record.maleEntryId
    const existingEvent = currentPollinationEvents.find(
      event => _.toString(event.pollinationIntentId) === _.toString(pollinationIntentId) &&
        event.source?.femaleSetEntryIds?.includes(_.toString(femaleEntryId)) &&
        (_.isNil(maleEntryId) || event.source?.maleSetEntryIds?.includes(_.toString(maleEntryId)))
    )

    console.log({ existingEvent, currentPollinationEvents, pollinationIntentId, femaleEntryId, maleEntryId })

    const attempt = {
      attemptedBy: record.userId,
      attemptedOn: record.dateTime,
      attemptCount: record.attemptedEventCount,
    }

    pollinationEvent.attempts = [ attempt ]
    pollinationEvent.crossType = record.pollinationCrossInstruction.crossType
    pollinationEvent.locationId = record.locationId
    pollinationEvent.locationType = record.locationType
    pollinationEvent.pollinationIntentId = record.id
    // tried various things but lint doesn't like the below not sure why?? commented for now:
    // const opPrefix = record?.pollinationOperations?.replace('_POLLINATION', '')

    // pollinationEvent.pollinationOperation = `POLLINATION_OPERATION_${opPrefix}`
    const femaleSetEntryIds = [ record.femaleEntryId ]
    // If its a SELF Validate ....
    const maleSetEntryIds = record.maleEntryId ? [ record.maleEntryId ] : undefined
    const source = {
      femaleSetEntryIds,
      maleSetEntryIds,
    }

    pollinationEvent.source = source
    if (_.isNil(existingEvent)) {
      pollinationEvents.push(pollinationEvent)
    } else {
      attempt.pollinationEventId = _.last(_.split(existingEvent.name, '/'))
      attempts.push(attempt)
    }
  })

  assemblyState.derivedParameters.pollinationEvents = pollinationEvents
  assemblyState.derivedParameters.attempts = attempts

  return taskPayload
}
