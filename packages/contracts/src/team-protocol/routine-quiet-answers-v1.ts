// Frozen optional routine-quiet-answers-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: a client that sends it gets the
// chat messages with the item type `routine_quiet_answer` (`ROUTINE_QUIET_ANSWER_ITEM_TYPE`), in pages,
// live events and read state. Each one is the text answer of a routine run or a teammate update that
// ended with nothing to report. The client shows it under its run or update marker, which starts
// closed, or not at all; never as a new answer. A host without it, or a client that does not send it,
// leaves these messages out. It adds no route and no field. A protocol 10 capability only.
export const ROUTINE_QUIET_ANSWERS_CAPABILITY = "routine-quiet-answers-v1";
