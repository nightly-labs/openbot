import { ArticleGif } from "../../components/content/ArticleMedia";
import firstReply from "./media/give-an-agent-its-first-task/first-reply.gif";
import firstReplyStill from "./media/give-an-agent-its-first-task/first-reply-still.webp";

export function GiveAnAgentItsFirstTask() {
  return (
    <>
      <p>
        An agent is not a chat window with a folder attached. It keeps a workspace, a thread and an identity between
        runs, so the first task you give it is also the first thing it will remember.
      </p>

      <h2>Make the agent</h2>
      <p>
        Create an agent and give it a name you will recognise in a list of six. OpenBot gives it a directory of its own
        under ~/OpenBot: its workspace. The workspace is kept between runs, and it is where the agent keeps its files.
      </p>
      <p>
        It is not a fence. The agent can read and change files anywhere on your computer, so say in your instruction
        where its work belongs.
      </p>

      <h2>Ask for something small</h2>
      <p>
        A good first instruction is specific and checkable. "Read the README and tell me which commands it claims to
        support" is a first task. "Improve the project" is not: you cannot tell whether the answer is right, so you
        learn nothing about the agent from it.
      </p>
      <p>
        Watch what it does rather than only what it says. The activity list shows every file it reads and every command
        it runs, which is the part worth reading on a first run.
      </p>

      <ArticleGif
        src={firstReply}
        still={firstReplyStill}
        width={800}
        height={500}
        alt="An agent answers a question about failing tests, a few words at a time, and names one cause shared by two of them."
        caption="The answer arrives as it is written, in the thread that keeps it."
      />

      <h2>Then keep going in the same thread</h2>
      <p>
        Follow-up questions belong in the thread you already have. The context that made the first answer good is still
        there, and starting again throws it away for no gain.
      </p>
    </>
  );
}
