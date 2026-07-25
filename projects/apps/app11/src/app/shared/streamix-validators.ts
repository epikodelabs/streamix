import { Directive } from "@angular/core";
import {
  asyncFieldValidation,
  MarkerFieldValidatorDirective,
  MarkerFormValidatorDirective,
} from "./validator-directive";
import {
  passwordMatchCheck,
  reservedUsername,
} from "./profile-form";

@Directive({
  selector: "input[sxField][sxReservedUsername]",
  standalone: true,
})
export class StreamixReservedUsernameDirective
  extends MarkerFieldValidatorDirective {
  protected validation() {
    return asyncFieldValidation<string>(
      (value, signal) =>
        reservedUsername(value, signal),
      { asyncDelay: 250 },
    );
  }
}

@Directive({
  selector: "[sxFormNode][sxPasswordMatch]",
  standalone: true,
})
export class StreamixPasswordMatchDirective
  extends MarkerFormValidatorDirective {
  protected validator() {
    return (value: Record<string, unknown>) =>
      passwordMatchCheck(value as {
        password: string;
        confirmPassword: string;
      });
  }
}
