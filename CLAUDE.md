I want to have a robot that controls my computer.
The the whole idea is to have periodic screenshots of all the  
available monitors and control the mouse via robot.js based on those screenshots.

The screenshots will be fed to an LLM (Large Language Model) that will analyze the images and determine the appropriate actions to take, such as moving the mouse, clicking, or typing. The LLM will generate commands that will be sent back to the robot.js script to execute on the computer.

For the mvp , we can start with a simple implementation that captures screenshots at regular intervals, skip the LLM for now, and executes basic mouse movements and clicks. For this i wanna have a mode where i can register specific areas of the screen (like buttons or input fields) and define actions for those areas. The robot will then monitor those areas and perform the defined actions when certain conditions are met (like a button appearing or a specific color change).

The whole app should use typescript, npm monorepo, prettier, eslint, vitest, react, knip, lint-staged, syncpack where appropriate. The project structure should be organized in a way that separates the core functionality (screenshot capturing, mouse control) from the user interface and configuration.