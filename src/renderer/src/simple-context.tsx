import { createContext, type ParentProps, useContext } from "solid-js";

export function createSimpleContext<Value extends object, Props extends object = Record<never, never>>(input: {
  name: string;
  init: (props: Props) => Value;
}) {
  const Context = createContext<Value>(undefined, { name: input.name });

  function provider(props: ParentProps<Props>) {
    const value = input.init(props);
    return <Context value={value}>{props.children}</Context>;
  }

  function use(): Value {
    try {
      return useContext(Context);
    } catch (cause) {
      throw new Error(`${input.name} is unavailable outside its provider.`, { cause });
    }
  }

  return { provider, use };
}
