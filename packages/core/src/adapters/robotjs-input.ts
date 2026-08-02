// Default import on purpose: the native module is CJS whose named exports are not
// statically analyzable, so a namespace import arrives empty at runtime under esbuild/tsx.
import robot from '@hurdlegroup/robotjs';
import type { Modifier, MouseButton, Point } from '@autopoker/shared';
import type { InputController } from '../types';

export class RobotInputController implements InputController {
  moveMouse(point: Point): void {
    robot.moveMouse(point.x, point.y);
  }

  click(button: MouseButton, double: boolean): void {
    robot.mouseClick(button, double);
  }

  typeText(text: string): void {
    robot.typeString(text);
  }

  keyTap(key: string, modifiers: Modifier[]): void {
    robot.keyTap(key, modifiers.length > 0 ? [...modifiers] : undefined);
  }

  getMousePos(): Point {
    return robot.getMousePos();
  }
}
