class AgentKeyError(Exception):
    def __init__(self, code, hint=None):
        super().__init__(f"{code}: {hint}" if hint else code)
        self.code, self.hint = code, hint
