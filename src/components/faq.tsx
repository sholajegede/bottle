const questions: Array<[string, string]> = [
  [
    "What is a bottle?",
    "A bottle is a message or a webhook with a delivery time. You write it now. Bottle keeps it and sends it at the time you set.",
  ],
  [
    "What does \"once\" mean here?",
    "Bottle stores every bottle before it confirms it, sends it when it is due, and records the result. If a send fails, Bottle tries again with the same id, so the receiver can tell a second copy from a new bottle.",
  ],
  [
    "Can I cancel a bottle?",
    "Yes. You can cancel a bottle until it goes out. You get the bottle back in your monthly count.",
  ],
  [
    "Who can read my bottles?",
    "Your bottles are stored in the Bottle database so they can be sent later. Only your account can list them. The Engine Room shows event types and counts, never message text.",
  ],
  [
    "Where does Kinde fit?",
    "Kinde handles sign-in and billing. When you change plan or a payment goes through, Kinde sends an event. Bottle stores that event with the same care it gives your bottles, so a repeated event cannot change your plan twice.",
  ],
  [
    "Is Bottle open source?",
    "Yes. The code is on GitHub under the MIT licence. You can read it, run it, and change it.",
  ],
];

export function Faq() {
  return (
    <div className="mx-auto max-w-[760px] divide-y divide-line border-y border-line">
      {questions.map(([question, answer]) => (
        <details key={question} className="group py-1">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-[0.95rem] font-medium">
            {question}
            <span aria-hidden className="text-soft transition-transform group-open:rotate-45">
              +
            </span>
          </summary>
          <p className="pb-5 pr-8 text-sm leading-relaxed text-soft">{answer}</p>
        </details>
      ))}
    </div>
  );
}
