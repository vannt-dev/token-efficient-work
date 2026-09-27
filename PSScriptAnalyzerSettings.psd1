@{
    # The installers talk to the person running them, so writing to the host is intended.
    ExcludeRules = @('PSAvoidUsingWriteHost')
}
