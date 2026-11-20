import { type ButtonRootProps, Root } from "@kobalte/core/button";
import type { PolymorphicProps } from "@kobalte/core/polymorphic";
import { cx } from "@openbot/ui/utils";
import { createLink } from "@tanstack/solid-router";
import { cva, type VariantProps } from "class-variance-authority";
import { omit } from "solid-js";

const buttonVariants = cva("landing-button", {
  variants: {
    variant: {
      primary: "landing-button-primary",
      secondary: "landing-button-secondary",
    },
    size: {
      sm: "landing-button-sm",
      md: "landing-button-md",
      lg: "landing-button-lg",
    },
  },
  defaultVariants: {
    variant: "secondary",
    size: "md",
  },
});

export type ButtonProps = Omit<PolymorphicProps<"a", ButtonRootProps<"a">>, "class"> &
  VariantProps<typeof buttonVariants> & {
    class?: string;
    icon: "arrow-right" | "contact" | "download" | "github" | "open";
  };

export function Button(props: ButtonProps) {
  const others = omit(props, "variant", "size", "class", "children", "icon");
  return (
    <Root
      as="a"
      class={cx(buttonVariants({ variant: props.variant, size: props.size }), props.class)}
      data-slot="button"
      data-icon={props.icon}
      {...others}
    >
      {props.children}
    </Root>
  );
}

export const ButtonLink = createLink(Button);
