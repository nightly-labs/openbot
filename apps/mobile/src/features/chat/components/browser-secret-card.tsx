import type { BrowserTakeoverRequest, RespondToBrowserSecretInput } from "@openbot/contracts/ipc";
import { Button, Input, Typography } from "heroui-native";
import { useState } from "react";
import { View } from "react-native";

export function BrowserSecretCard({
  request,
  respond,
  respondToTakeover,
}: {
  request: BrowserTakeoverRequest;
  respondToTakeover: (decision: "complete" | "cancel") => Promise<void>;
  respond: (input: RespondToBrowserSecretInput) => Promise<void>;
}) {
  const [value, setValue] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const password = request.secret?.method === "password";
  const digits = request.secret?.digits ?? 6;
  const title = password
    ? "Password"
    : request.secret?.method === "authenticator"
      ? "Authenticator code"
      : "One-time code";
  const send = async (decision: "submit" | "cancel" | "takeover") => {
    if (pending) return;
    setPending(true);
    setError(false);
    const identity = { agentId: request.agentId, requestId: request.requestId };
    const input: RespondToBrowserSecretInput =
      decision === "submit" ? { ...identity, decision, secret: value } : { ...identity, decision };
    setValue("");
    try {
      await respond(input);
    } catch {
      setError(true);
    } finally {
      if (input.decision === "submit") input.secret = "";
      setPending(false);
    }
  };
  if (!request.secret || request.secret.requiresReload) {
    const finish = async (decision: "complete" | "cancel") => {
      if (pending) return;
      setPending(true);
      setError(false);
      try {
        await respondToTakeover(decision);
      } catch {
        setError(true);
      } finally {
        setPending(false);
      }
    };
    return (
      <View className="gap-2 border-t border-border bg-background p-4">
        <Typography.Heading>Browser takeover</Typography.Heading>
        <Typography.Paragraph>
          Complete this step in the browser on the computer running OpenBot.{" "}
          {request.secret?.requiresReload ? "Then reload the page before choosing I’m done." : ""}
        </Typography.Paragraph>
        {error ? (
          <Typography.Paragraph accessibilityRole="alert">The request could not be completed.</Typography.Paragraph>
        ) : null}
        <View className="flex-row gap-2">
          <Button isDisabled={pending} onPress={() => void finish("complete")}>
            <Button.Label>I'm done</Button.Label>
          </Button>
          <Button variant="secondary" isDisabled={pending} onPress={() => void finish("cancel")}>
            <Button.Label>Cancel</Button.Label>
          </Button>
        </View>
      </View>
    );
  }
  return (
    <View className="gap-2 border-t border-border bg-background p-4">
      <Typography.Heading>{title}</Typography.Heading>
      <Typography.Paragraph>
        Submit once to {request.secret?.origin}. This value is not added to chat.
      </Typography.Paragraph>
      <Input
        accessibilityLabel={title}
        secureTextEntry
        autoCorrect={false}
        autoCapitalize="none"
        keyboardType={password ? "default" : "number-pad"}
        autoComplete={password ? "off" : "one-time-code"}
        maxLength={password ? 4096 : digits}
        value={value}
        editable={!pending}
        onChangeText={(text) => setValue(password ? text : text.replace(/[^0-9]/gu, "").slice(0, digits))}
      />
      {!password ? (
        <Typography className="text-center tracking-widest" accessible={false}>
          {Array.from({ length: digits }, (_, index) => (index < value.length ? "•" : "–")).join(" ")}
        </Typography>
      ) : null}
      {error ? (
        <Typography.Paragraph accessibilityRole="alert">
          The request could not be completed. Check the connection and try again.
        </Typography.Paragraph>
      ) : null}
      <View className="flex-row gap-2">
        <Button
          isDisabled={pending || (password ? !value : value.length !== digits)}
          onPress={() => void send("submit")}
        >
          <Button.Label>Submit</Button.Label>
        </Button>
        <Button variant="secondary" isDisabled={pending} onPress={() => void send("cancel")}>
          <Button.Label>Cancel</Button.Label>
        </Button>
        <Button variant="tertiary" isDisabled={pending} onPress={() => void send("takeover")}>
          <Button.Label>Take over</Button.Label>
        </Button>
      </View>
    </View>
  );
}
